"""Tool definitions and execution handlers for the FinSight agent."""

import logging
import operator

from app.bedrock import _retrieve
from app.documents import list_documents

logger = logging.getLogger(__name__)

# Whitelisted operations for the calculate tool.
# No eval(), no arbitrary code — just safe arithmetic.
_OPS = {
    "add": operator.add,
    "subtract": operator.sub,
    "multiply": operator.mul,
    "divide": operator.truediv,
    "percentage_change": lambda old, new: ((new - old) / old) * 100,
    "percentage_of": lambda part, whole: (part / whole) * 100,
    "difference": lambda a, b: a - b,
}

TOOL_SPECS = [
    {
        "toolSpec": {
            "name": "search_documents",
            "description": (
                "Search the financial document corpus for information relevant to a query. "
                "Use this to find specific facts, figures, disclosures, or commentary "
                "from annual reports, earnings transcripts, and regulatory filings. "
                "Returns the most relevant text passages with source attribution. "
                "Use specific financial terms in the query for best results."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": (
                                "The search query. Be specific — include company name, "
                                "metric name, and time period where possible. "
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
                "List all documents in the corpus with their metadata: "
                "company name, document type, reporting period, and upload date. "
                "Use this to find out what filings are available before searching, "
                "or to answer questions like 'which companies do you have reports for?'"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "company": {
                            "type": "string",
                            "description": (
                                "Optional filter by company name. "
                                "Leave empty to list all documents."
                            ),
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
                "Search for a specific named financial metric across one or more "
                "companies. Optimised for extracting numerical values like ratios, "
                "margins, totals, and percentages. "
                "For comparing the same metric across multiple companies, call this "
                "tool once per company."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "metric_name": {
                            "type": "string",
                            "description": (
                                "The financial metric to extract, e.g. "
                                "'CET1 ratio', 'net interest margin', 'return on equity', "
                                "'operating profit', 'cost-to-income ratio'."
                            ),
                        },
                        "company": {
                            "type": "string",
                            "description": "The company to extract the metric for.",
                        },
                        "period": {
                            "type": "string",
                            "description": (
                                "Reporting period, e.g. '2024', '2023', 'Q3 2024'. "
                                "Optional — omit to get the most recent available."
                            ),
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
                "Retrieve a full named section from a company's filing. "
                "Use for summaries or detailed reading of a specific part of a report. "
                "Common sections: 'Risk Factors', 'Capital Adequacy', "
                "'CEO Statement', 'Outlook', 'Segment Reporting', "
                "'Net Interest Income', 'Credit Risk', 'Liquidity'."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "section_name": {
                            "type": "string",
                            "description": ("The section to retrieve, e.g. 'Risk Factors'."),
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
                "Perform verified arithmetic on financial figures. Use this "
                "instead of mental maths to ensure accuracy. Supports: "
                "add, subtract, multiply, divide, percentage_change "
                "(old→new), percentage_of (part/whole), difference. "
                "Example: percentage_change from 12.5 to 14.9, or "
                "difference between CET1 ratio 14.9% and minimum 4.5%."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "operation": {
                            "type": "string",
                            "enum": list(_OPS.keys()),
                            "description": "The arithmetic operation.",
                        },
                        "a": {
                            "type": "number",
                            "description": (
                                "First operand. For percentage_change this is the old value."
                            ),
                        },
                        "b": {
                            "type": "number",
                            "description": (
                                "Second operand. For percentage_change this is the new value."
                            ),
                        },
                        "label": {
                            "type": "string",
                            "description": (
                                "What this calculation represents, e.g. "
                                "'HSBC CET1 headroom above 4.5% minimum'."
                            ),
                        },
                    },
                    "required": ["operation", "a", "b"],
                }
            },
        }
    },
]


def _exec_search_documents(tool_input: dict) -> dict:
    chunks = _retrieve(tool_input["query"])
    if not chunks:
        return {
            "results": [],
            "message": "No relevant documents found for this query.",
        }
    return {
        "results": [
            {
                "text": c["content"],
                "source": c["source"],
                "relevance_score": round(c["score"], 3),
            }
            for c in chunks
        ]
    }


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
            "message": f"No data found for {metric} at {company}.",
        }
    return {
        "metric": metric,
        "company": company,
        "results": [
            {
                "text": c["content"],
                "source": c["source"],
                "relevance_score": round(c["score"], 3),
            }
            for c in chunks
        ],
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
            "message": (f"Could not find '{section}' section for {company}."),
        }
    return {
        "section": section,
        "company": company,
        "results": [
            {
                "text": c["content"],
                "source": c["source"],
                "relevance_score": round(c["score"], 3),
            }
            for c in chunks
        ],
    }


def _exec_calculate(tool_input: dict) -> dict:
    op_name = tool_input["operation"]
    a = tool_input["a"]
    b = tool_input["b"]
    label = tool_input.get("label", "")

    op_fn = _OPS.get(op_name)
    if not op_fn:
        return {"error": f"Unknown operation: {op_name}"}

    if op_name in ("divide", "percentage_change", "percentage_of"):
        if (op_name == "divide" and b == 0) or (
            op_name in ("percentage_change", "percentage_of") and a == 0
        ):
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


TOOL_HANDLERS = {
    "search_documents": _exec_search_documents,
    "get_filing_metadata": _exec_get_filing_metadata,
    "extract_metric": _exec_extract_metric,
    "get_section": _exec_get_section,
    "calculate": _exec_calculate,
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
