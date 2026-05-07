"""Tool definitions and execution handlers for the FinSight agent."""

import logging
import operator

from app.bedrock import _retrieve
from app.documents import list_documents

logger = logging.getLogger(__name__)

_OPS = {
    "add": operator.add,
    "subtract": operator.sub,
    "multiply": operator.mul,
    "divide": operator.truediv,
    "percentage_change": lambda old, new: ((new - old) / old) * 100,
    "percentage_of": lambda part, whole: (part / whole) * 100,
    "difference": lambda a, b: a - b,
}

# Limit text per chunk to keep context size manageable across
# multi-iteration agent loops.
_MAX_CHUNK_CHARS = 1000

TOOL_SPECS = [
    {
        "toolSpec": {
            "name": "search_documents",
            "description": (
                "Search the financial document corpus for information "
                "relevant to a query. Returns the most relevant text "
                "passages with source attribution. Use specific "
                "financial terms in the query for best results."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": (
                                "Search query. Be specific — include "
                                "company name, metric, and period. "
                                "Example: 'HSBC net interest margin 2024'"
                            ),
                        },
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_filing_metadata",
            "description": (
                "List all documents in the corpus with metadata: "
                "company name, document type, reporting period. "
                "Use to check what filings are available."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "company": {
                            "type": "string",
                            "description": ("Optional company name filter."),
                        },
                    },
                    "required": [],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "extract_metric",
            "description": (
                "Extract a specific financial metric for a company. "
                "Optimised for numerical values: ratios, margins, "
                "totals, percentages. Call once per company."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "metric_name": {
                            "type": "string",
                            "description": (
                                "The metric, e.g. 'CET1 ratio', "
                                "'net interest margin', 'return on "
                                "equity', 'cost-to-income ratio'."
                            ),
                        },
                        "company": {
                            "type": "string",
                            "description": ("The company to extract from."),
                        },
                        "period": {
                            "type": "string",
                            "description": ("Reporting period, e.g. '2024'. Optional."),
                        },
                    },
                    "required": ["metric_name", "company"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_section",
            "description": (
                "Retrieve a named section from a company's filing. "
                "Common sections: 'Risk Factors', 'Capital Adequacy', "
                "'CEO Statement', 'Outlook', 'Credit Risk', "
                "'Liquidity'."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "section_name": {
                            "type": "string",
                            "description": ("Section name, e.g. 'Risk Factors'."),
                        },
                        "company": {
                            "type": "string",
                            "description": ("The company whose filing to search."),
                        },
                    },
                    "required": ["section_name", "company"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "calculate",
            "description": (
                "Verified arithmetic on financial figures. Use instead "
                "of mental maths. Supports: add, subtract, multiply, "
                "divide, percentage_change (old→new), percentage_of "
                "(part/whole), difference."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "operation": {
                            "type": "string",
                            "enum": list(_OPS.keys()),
                            "description": "The operation.",
                        },
                        "a": {
                            "type": "number",
                            "description": ("First operand (old value for percentage_change)."),
                        },
                        "b": {
                            "type": "number",
                            "description": ("Second operand (new value for percentage_change)."),
                        },
                        "label": {
                            "type": "string",
                            "description": (
                                "What this calculates, e.g. 'HSBC CET1 headroom above 4.5%'."
                            ),
                        },
                    },
                    "required": ["operation", "a", "b"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "generate_briefing",
            "description": (
                "Generate a structured briefing document from research "
                "findings. Call AFTER gathering data with other tools. "
                "The briefing output is the final answer — return it "
                "verbatim, do not rewrite it."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": (
                                "Briefing title, e.g. 'HSBC vs Barclays: Capital Position'."
                            ),
                        },
                        "executive_summary": {
                            "type": "string",
                            "description": ("2-3 sentence overview of findings."),
                        },
                        "sections": {
                            "type": "array",
                            "description": "Briefing sections.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "heading": {
                                        "type": "string",
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": (
                                            "Markdown with tables, figures, and citations."
                                        ),
                                    },
                                },
                                "required": [
                                    "heading",
                                    "content",
                                ],
                            },
                        },
                        "sources": {
                            "type": "array",
                            "description": "Source documents used.",
                            "items": {"type": "string"},
                        },
                    },
                    "required": [
                        "title",
                        "executive_summary",
                        "sections",
                        "sources",
                    ],
                }
            },
        }
    },
]


def _format_chunks(chunks: list[dict]) -> list[dict]:
    return [
        {
            "text": c["content"][:_MAX_CHUNK_CHARS],
            "source": c["source"],
            "relevance_score": round(c["score"], 3),
        }
        for c in chunks
    ]


def _exec_search_documents(tool_input: dict) -> dict:
    chunks = _retrieve(tool_input["query"])
    if not chunks:
        return {
            "results": [],
            "message": "No relevant documents found.",
        }
    return {"results": _format_chunks(chunks)}


def _exec_get_filing_metadata(tool_input: dict) -> dict:
    docs = list_documents()
    company_filter = tool_input.get("company", "").lower()
    if company_filter:
        docs = [d for d in docs if company_filter in d.get("company", "").lower()]
    return {
        "documents": [
            {
                "company": d.get("company", "unknown"),
                "document_type": d.get("docType", "unknown"),
                "period": d.get("period", "unknown"),
                "filename": d.get("filename", "unknown"),
                "status": d.get("status", "unknown"),
            }
            for d in docs
        ]
    }


def _exec_extract_metric(tool_input: dict) -> dict:
    metric = tool_input["metric_name"]
    company = tool_input["company"]
    period = tool_input.get("period", "")

    query = f"{company} {metric}"
    if period:
        query += f" {period}"

    chunks = _retrieve(query)
    if not chunks:
        return {
            "metric": metric,
            "company": company,
            "results": [],
            "message": (f"No data found for {metric} at {company}."),
        }
    return {
        "metric": metric,
        "company": company,
        "results": _format_chunks(chunks),
    }


def _exec_get_section(tool_input: dict) -> dict:
    section = tool_input["section_name"]
    company = tool_input["company"]

    chunks = _retrieve(f"{company} {section}")
    if not chunks:
        return {
            "section": section,
            "company": company,
            "results": [],
            "message": (f"Could not find '{section}' for {company}."),
        }
    return {
        "section": section,
        "company": company,
        "results": _format_chunks(chunks),
    }


def _exec_calculate(tool_input: dict) -> dict:
    op_name = tool_input["operation"]
    a = tool_input["a"]
    b = tool_input["b"]
    label = tool_input.get("label", "")

    op_fn = _OPS.get(op_name)
    if not op_fn:
        return {"error": f"Unknown operation: {op_name}"}

    divisor_is_zero = (op_name == "divide" and b == 0) or (
        op_name in ("percentage_change", "percentage_of") and a == 0
    )
    if divisor_is_zero:
        return {
            "error": "Division by zero",
            "operation": op_name,
            "a": a,
            "b": b,
        }

    result = round(op_fn(a, b), 4)
    return {
        "result": result,
        "operation": op_name,
        "a": a,
        "b": b,
        "label": label,
        "formatted": f"{result:,.4f}".rstrip("0").rstrip("."),
    }


def _exec_generate_briefing(tool_input: dict) -> dict:
    title = tool_input["title"]
    summary = tool_input["executive_summary"]
    sections = tool_input.get("sections", [])
    sources = tool_input.get("sources", [])

    lines = [
        f"# {title}",
        "",
        "*Prepared by FinSight · Investment Analyst Copilot*",
        "",
        "---",
        "",
        "## Executive Summary",
        "",
        summary,
        "",
    ]

    for section in sections:
        lines.append(f"## {section['heading']}")
        lines.append("")
        lines.append(section["content"])
        lines.append("")

    if sources:
        lines.append("---")
        lines.append("")
        lines.append("## Sources")
        lines.append("")
        for s in sources:
            lines.append(f"- {s}")
        lines.append("")

    briefing_markdown = "\n".join(lines)

    return {
        "briefing": briefing_markdown,
        "title": title,
        "section_count": len(sections),
        "source_count": len(sources),
    }


TOOL_HANDLERS = {
    "search_documents": _exec_search_documents,
    "get_filing_metadata": _exec_get_filing_metadata,
    "extract_metric": _exec_extract_metric,
    "get_section": _exec_get_section,
    "calculate": _exec_calculate,
    "generate_briefing": _exec_generate_briefing,
}


def execute_tool(tool_name: str, tool_input: dict) -> dict:
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        logger.error("Unknown tool requested: %s", tool_name)
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        result = handler(tool_input)
        count = len(
            result.get("results", result.get("documents", [])),
        )
        summary = result.get("formatted", f"{count} results")
        logger.info("Tool %s: %s", tool_name, summary)
        return result
    except Exception:
        logger.exception("Tool %s failed", tool_name)
        return {"error": f"Tool {tool_name} failed to execute."}
