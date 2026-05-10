"""RAG evaluation pipeline.

Sends curated test questions through the agent, then uses a cheaper
model (Haiku) as an LLM judge to score relevance and faithfulness.

Usage:
  # Run against deployed stack
  ALB_URL=http://xxx python -m eval.run_eval

  # Run against local backend
  ALB_URL=http://localhost:8000 python -m eval.run_eval

  # Run a subset
  ALB_URL=http://xxx python -m eval.run_eval --category metric_extraction
"""

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import boto3
import requests

from app.eval_store import save_eval_run

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))
ALB_URL = os.environ.get("ALB_URL", "").rstrip("/")
JUDGE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

JUDGE_SYSTEM = """You are an evaluation judge for a RAG (Retrieval-Augmented Generation) system.
You will be given a question, the expected answer, and the system's actual answer.
Score the answer on two dimensions:

1. RELEVANCE (1-5): Does the answer address the question asked?
   1 = Completely irrelevant or no answer
   2 = Partially relevant but misses the main point
   3 = Relevant but incomplete
   4 = Relevant and mostly complete
   5 = Directly and fully answers the question

2. FAITHFULNESS (1-5): Is the answer grounded in facts (not hallucinated)?
   1 = Clearly fabricated or contradicts expected answer
   2 = Contains significant unsupported claims
   3 = Mostly grounded but some unverifiable claims
   4 = Well grounded with minor uncertainties
   5 = Fully grounded, matches expected answer

For the "not_found" category: score 5/5 if the system correctly says
it cannot find the information, and 1/1 if it hallucinates an answer.

Respond ONLY with JSON:
{"relevance": <1-5>, "faithfulness": <1-5>, "reasoning": "<brief explanation>"}"""


def _call_agent(question: str) -> dict:
    """Call the agent endpoint and collect the response."""
    resp = requests.post(
        f"{ALB_URL}/research/agent/stream",
        json={"message": question, "history": []},
        stream=True,
        timeout=180,
    )
    resp.raise_for_status()

    text_chunks = []
    tool_calls = []
    token_usage = {"input": 0, "output": 0}
    guardrail_blocked = False

    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        try:
            event = json.loads(line[6:])
        except json.JSONDecodeError:
            continue

        if event.get("type") == "delta":
            text_chunks.append(event.get("text", ""))
        elif event.get("type") == "tool_call":
            tool_calls.append(event.get("tool", ""))
        elif event.get("type") == "done":
            token_usage = event.get("token_usage", token_usage)
        elif event.get("type") == "guardrail_blocked":
            guardrail_blocked = True
            text_chunks.append(event.get("message", ""))

    return {
        "answer": "".join(text_chunks),
        "tool_calls": tool_calls,
        "token_usage": token_usage,
        "guardrail_blocked": guardrail_blocked,
    }


def _judge_answer(question: str, expected: str, actual: str, category: str) -> dict:
    """Use Haiku as an LLM judge to score the answer."""
    prompt = f"""Question: {question}

Expected answer: {expected}

Actual answer from the system:
{actual[:3000]}

Category: {category}

Score this answer."""

    try:
        response = bedrock.converse(
            modelId=JUDGE_MODEL,
            system=[{"text": JUDGE_SYSTEM}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 500, "temperature": 0.0},
        )

        judge_text = ""
        for block in response["output"]["message"]["content"]:
            if "text" in block:
                judge_text += block["text"]

        # Parse JSON from judge response
        judge_text = judge_text.strip()
        if judge_text.startswith("```"):
            judge_text = judge_text.split("\n", 1)[1].rsplit("```", 1)[0]

        scores = json.loads(judge_text)
        return {
            "relevance": scores.get("relevance", 0),
            "faithfulness": scores.get("faithfulness", 0),
            "reasoning": scores.get("reasoning", ""),
            "judge_tokens": response.get("usage", {}),
        }

    except Exception as e:
        print(f"  ⚠ Judge failed: {e}")
        return {
            "relevance": 0,
            "faithfulness": 0,
            "reasoning": f"Judge error: {e}",
            "judge_tokens": {},
        }


def run_eval(dataset_path: str, category_filter: str | None = None) -> dict:
    """Run the full evaluation pipeline."""
    with open(dataset_path) as f:
        dataset = json.load(f)

    if category_filter:
        dataset = [d for d in dataset if d["category"] == category_filter]

    print(f"\n{'=' * 60}")
    print("FinSight RAG Evaluation Pipeline")
    print(f"{'=' * 60}")
    print(f"Dataset: {len(dataset)} questions")
    print(f"Target: {ALB_URL}")
    print(f"Judge: {JUDGE_MODEL}")
    print(f"{'=' * 60}\n")

    results = []
    total_relevance = 0
    total_faithfulness = 0

    for i, item in enumerate(dataset):
        qid = item["id"]
        question = item["question"]
        expected = item["expected_answer"]
        category = item["category"]

        print(f"[{i + 1}/{len(dataset)}] {qid}")
        print(f"  Q: {question}")

        # Call the agent
        start = time.time()
        agent_result = _call_agent(question)
        latency = time.time() - start
        answer = agent_result["answer"]

        print(f"  A: {answer[:120]}...")
        print(f"  ⏱ {latency:.1f}s | 🔧 {len(agent_result['tool_calls'])} tools")

        # Judge the answer
        scores = _judge_answer(question, expected, answer, category)
        relevance = scores["relevance"]
        faithfulness = scores["faithfulness"]
        total_relevance += relevance
        total_faithfulness += faithfulness

        print(f"  📊 Relevance: {relevance}/5 | Faithfulness: {faithfulness}/5")
        print(f"  💬 {scores['reasoning'][:100]}")
        print()

        results.append(
            {
                "id": qid,
                "question": question,
                "expected": expected,
                "category": category,
                "answer": answer[:1000],
                "relevance": relevance,
                "faithfulness": faithfulness,
                "reasoning": scores["reasoning"],
                "latency_s": round(latency, 1),
                "tool_calls": agent_result["tool_calls"],
                "token_usage": agent_result["token_usage"],
                "guardrail_blocked": agent_result["guardrail_blocked"],
            }
        )

    # Aggregate scores
    n = len(results)
    avg_relevance = total_relevance / n if n else 0
    avg_faithfulness = total_faithfulness / n if n else 0

    # Per-category breakdown
    categories = {}
    for r in results:
        cat = r["category"]
        if cat not in categories:
            categories[cat] = {"relevance": [], "faithfulness": [], "count": 0}
        categories[cat]["relevance"].append(r["relevance"])
        categories[cat]["faithfulness"].append(r["faithfulness"])
        categories[cat]["count"] += 1

    category_scores = {}
    for cat, data in categories.items():
        category_scores[cat] = {
            "count": data["count"],
            "avg_relevance": sum(data["relevance"]) / len(data["relevance"]),
            "avg_faithfulness": sum(data["faithfulness"]) / len(data["faithfulness"]),
        }

    summary = {
        "timestamp": datetime.now(UTC).isoformat(),
        "dataset_size": n,
        "avg_relevance": round(avg_relevance, 2),
        "avg_faithfulness": round(avg_faithfulness, 2),
        "category_scores": category_scores,
        "results": results,
    }

    # Print summary
    print(f"{'=' * 60}")
    print("EVALUATION SUMMARY")
    print(f"{'=' * 60}")
    print(f"Questions evaluated: {n}")
    print(f"Average Relevance:   {avg_relevance:.2f}/5.0")
    print(f"Average Faithfulness:{avg_faithfulness:.2f}/5.0")
    print()
    print("By category:")
    for cat, scores in category_scores.items():
        print(
            f"  {cat}: relevance={scores['avg_relevance']:.2f} "
            f"faithfulness={scores['avg_faithfulness']:.2f} "
            f"(n={scores['count']})"
        )
    print(f"{'=' * 60}\n")

    # Save results
    output_dir = Path("eval/results")
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"eval_{timestamp}.json"

    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)

    # Save to DynamoDB for the admin dashboard
    try:
        eval_id = save_eval_run(summary)
        print(f"Saved to DynamoDB: {eval_id}")
    except Exception as e:
        print(f"Warning: Failed to save to DynamoDB: {e}")

    print(f"Results saved to {output_path}")
    return summary


def main():
    if not ALB_URL:
        print("ERROR: Set ALB_URL environment variable")
        print("  ALB_URL=http://localhost:8000 python -m eval.run_eval")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Run RAG evaluation")
    parser.add_argument(
        "--category",
        choices=[
            "metric_extraction",
            "section_retrieval",
            "comparison",
            "not_found",
        ],
        help="Filter to a specific category",
    )
    parser.add_argument(
        "--dataset",
        default="eval/eval_dataset.json",
        help="Path to the evaluation dataset",
    )
    args = parser.parse_args()

    run_eval(args.dataset, args.category)


if __name__ == "__main__":
    main()
