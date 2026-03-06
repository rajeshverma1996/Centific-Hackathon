from __future__ import annotations

import json
import logging
import re
import hashlib
import time
import uuid
from typing import Any
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, urlunparse

import httpx
import openai

import config as app_config
from .base import BaseAdapter, RawItem

logger = logging.getLogger(__name__)


def _make_webhook_path(label: str) -> str:
    """Generate a unique, URL-safe webhook path from the source label."""
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:30]
    short_hash = hashlib.md5(label.encode()).hexdigest()[:6]
    return f"scout-{slug}-{short_hash}"


def _probe_api(api_url: str, config: dict[str, Any]) -> dict:
    """Call the API URL and return a sample of the response for analysis."""
    headers: dict[str, str] = {"User-Agent": "ScoutBot/1.0"}
    if config.get("api_key"):
        headers["Authorization"] = f"Bearer {config['api_key']}"
    for k, v in (config.get("headers") or {}).items():
        headers[str(k)] = str(v)

    method = config.get("http_method", "GET").upper()
    params: dict[str, Any] = {}
    body_json = None

    if method == "GET":
        param_name = config.get("query_param", "")
        topic = config.get("topic", "")
        if param_name and topic:
            params[param_name] = topic
        limit_param = config.get("limit_param", "")
        if limit_param:
            params[limit_param] = config.get("items_per_day", 10)
    else:
        body_json = config.get("request_body")

    # Merge URL's existing query params with our new ones
    parsed = urlparse(api_url)
    if parsed.query:
        existing_params = parse_qs(parsed.query, keep_blank_values=True)
        for k, v in existing_params.items():
            if k not in params:
                params[k] = v[0] if len(v) == 1 else v
        api_url = urlunparse(parsed._replace(query=""))

    logger.info("[N8nAdapter] Probing API: %s %s params=%s", method, api_url, params)

    resp = httpx.request(
        method, api_url,
        params=params if method == "GET" else None,
        json=body_json,
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()

    content_type = resp.headers.get("content-type", "")
    is_json = "json" in content_type or resp.text.strip().startswith(("{", "["))

    if is_json:
        data = resp.json()
    else:
        data = {"_raw_text": resp.text[:5000], "_content_type": content_type}

    return {
        "status_code": resp.status_code,
        "content_type": content_type,
        "is_json": is_json,
        "data": data,
        "sample": json.dumps(data, default=str)[:3000],
    }


def _truncate_val(v: Any, max_len: int = 120) -> Any:
    """Truncate a value for sample display."""
    if isinstance(v, str) and len(v) > max_len:
        return v[:max_len] + "..."
    if isinstance(v, (list, dict)):
        s = json.dumps(v, default=str)
        if len(s) > max_len:
            return s[:max_len] + "..."
        return v
    return v


def _analyze_api_response(probe: dict) -> dict:
    """Analyze the probed API response to determine structure.

    Returns an analysis dict with fields like nested_path (e.g. "data.children")
    and item_unwrap (e.g. "data") describing how to extract items from the response.
    """
    data = probe["data"]
    analysis: dict[str, Any] = {
        "is_array": isinstance(data, list),
        "is_object": isinstance(data, dict),
        "is_json": probe["is_json"],
        "is_primitive_array": False,
        "list_key": None,
        "nested_path": None,       # e.g. "data.children" for Reddit
        "item_unwrap": None,        # e.g. "data" if each item has {kind, data: {title...}}
        "item_keys": [],
        "title_key": None,
        "desc_key": None,
        "url_key": None,
        "date_key": None,
        "response_type": "unknown",
        "sample_item": None,        # first item after unwrapping, for AI reference
    }

    items = []

    if isinstance(data, list):
        if data and not isinstance(data[0], dict):
            analysis["is_primitive_array"] = True
            analysis["response_type"] = "primitive_array"
            return analysis
        items = data[:5]
        analysis["response_type"] = "json_array"

    elif isinstance(data, dict):
        # Level 1: direct list keys
        for key in ("data", "results", "items", "entries", "records",
                     "articles", "posts", "hits", "stories", "feed",
                     "nodes", "docs", "children"):
            if key in data and isinstance(data[key], list):
                analysis["list_key"] = key
                analysis["nested_path"] = key
                analysis["response_type"] = f"json_object_list_{key}"
                items = data[key][:5]
                break

        # Level 2: nested structures like Reddit {data: {children: [...]}}
        if not items:
            for outer_key in ("data", "response", "result", "payload", "body"):
                if outer_key in data and isinstance(data[outer_key], dict):
                    nested = data[outer_key]
                    for inner_key in ("children", "items", "results", "entries",
                                      "posts", "data", "records", "nodes", "list"):
                        if inner_key in nested and isinstance(nested[inner_key], list):
                            analysis["nested_path"] = f"{outer_key}.{inner_key}"
                            analysis["response_type"] = f"nested_{outer_key}_{inner_key}"
                            items = nested[inner_key][:5]
                            break
                    if items:
                        break

        if not items and "_raw_text" not in data:
            items = [data]
            analysis["response_type"] = "single_object"

    # Detect if items need unwrapping (e.g. Reddit: {kind:"t3", data:{title:...}})
    if items and isinstance(items[0], dict):
        first_raw = items[0]
        if "data" in first_raw and isinstance(first_raw["data"], dict):
            inner = first_raw["data"]
            useful_keys = {"title", "name", "headline", "url", "link",
                           "description", "summary", "body", "text", "selftext"}
            if useful_keys & set(inner.keys()):
                analysis["item_unwrap"] = "data"
                items = [i.get("data", i) if isinstance(i, dict) else i for i in items]

    if not items:
        return analysis

    first = items[0] if items else {}
    if isinstance(first, dict):
        analysis["item_keys"] = list(first.keys())[:30]
        analysis["sample_item"] = {k: _truncate_val(v) for k, v in list(first.items())[:15]}

        for k in ("title", "name", "headline", "subject", "label"):
            if k in first:
                analysis["title_key"] = k
                break

        for k in ("description", "summary", "abstract", "body", "content",
                   "text", "snippet", "excerpt", "selftext"):
            if k in first:
                analysis["desc_key"] = k
                break

        for k in ("html_url", "web_url", "permalink", "url", "link", "href"):
            if k in first:
                analysis["url_key"] = k
                break

        for k in ("published_at", "created_at", "date", "publishedAt",
                   "createdAt", "timestamp", "time", "updated_at", "pubDate",
                   "created_utc", "created"):
            if k in first:
                analysis["date_key"] = k
                break

    return analysis


def _describe_response_structure(probe: dict, analysis: dict) -> str:
    """Build a human-readable description of the API response structure for the AI."""
    parts = []

    if not analysis.get("is_json"):
        parts.append("The API returns non-JSON content (XML/HTML/text).")
        return "\n".join(parts)

    if analysis.get("is_array"):
        parts.append("The API returns a **JSON array** at the root level.")
        parts.append("Each element in the array is an item to process.")
    elif analysis.get("is_primitive_array"):
        parts.append("The API returns a JSON array of primitive values (strings/numbers), not objects.")
    elif analysis.get("nested_path"):
        path = analysis["nested_path"]
        parts.append(f"The API returns a **JSON object**. Items are nested at: `response.{path}`")
        if analysis.get("item_unwrap"):
            parts.append(
                f"Each item in the array has a wrapper -- the actual data is inside "
                f"`.{analysis['item_unwrap']}` of each item."
            )
            parts.append(
                f"So the full extraction path is: `response.{path}[].{analysis['item_unwrap']}`"
            )
    elif analysis.get("list_key"):
        parts.append(f"The API returns a JSON object with items in the `{analysis['list_key']}` key.")
    else:
        parts.append("The API returns a single JSON object (not a list).")

    rt = analysis.get("response_type", "unknown")
    parts.append(f"Response type classification: `{rt}`")

    return "\n".join(parts)


# ── AI Workflow Generation ────────────────────────────────────────────────

_WORKFLOW_SYSTEM_PROMPT = """You are an expert n8n workflow architect. You generate production-quality n8n workflow JSON.

## Available n8n Node Types (use EXACT type strings and typeVersions):

1. **n8n-nodes-base.webhook** (typeVersion: 2.1) -- Webhook trigger. MUST have "webhookId" field (UUID).
   Parameters: httpMethod, path, responseMode ("responseNode"), options: {}

2. **n8n-nodes-base.httpRequest** (typeVersion: 4.2) -- HTTP Request.
   GET: url, method ("GET"), sendQuery (true), queryParameters: {parameters: [{name, value}]}, options: {}
   POST: url, method ("POST"), sendBody (true), bodyParameters: {parameters: [{name, value}]}, options: {}

3. **n8n-nodes-base.code** (typeVersion: 2) -- JavaScript code execution.
   Parameters: jsCode (string). Access input: $input.all() or $input.first().json.
   Make HTTP requests: await this.helpers.httpRequest({method, url, headers, json: true})
   MUST return: [{json: {...}}] (array of objects with json key)

4. **n8n-nodes-base.set** (typeVersion: 3.4) -- Set/transform values.
   Parameters: assignments: {assignments: [{id: "uuid", name: "fieldName", value: "expression", type: "string"}]}, options: {}

5. **n8n-nodes-base.if** (typeVersion: 2.2) -- Conditional branching (true=output 0, false=output 1).
   Parameters: conditions: {options: {caseSensitive: true, leftValue: ""}, conditions: [{id: "uuid", leftValue: "={{ expr }}", rightValue: "0", operator: {type: "number", operation: "gt"}}], combinator: "and"}, options: {}

6. **n8n-nodes-base.respondToWebhook** (typeVersion: 1.4) -- Respond to webhook caller.
   Parameters: respondWith ("json"), responseBody ("={{ JSON.stringify($json) }}"), options: {}

## CRITICAL Rules:
- Every node MUST have: parameters, name (unique), type, typeVersion, position [x, y], id (UUID)
- Webhook node MUST also have "webhookId" (UUID)
- Connections: {"NodeName": {"main": [[{"node": "NextNode", "type": "main", "index": 0}]]}}
- IF connections: true branch = output index 0, false branch = output index 1
  Example: "Check Results": {"main": [[{"node": "TrueNode", ...}], [{"node": "FalseNode", ...}]]}
- Position: x increments by 300, y=300 main flow, y=500 alternate
- Settings: {"executionOrder": "v1"}
- Output: Return ONLY valid JSON. NO markdown fences. NO explanations."""


def _ai_generate_workflow(
    name: str,
    webhook_path: str,
    api_url: str,
    config: dict[str, Any],
    probe: dict,
    analysis: dict,
) -> dict | None:
    """Use GPT to generate a multi-node n8n workflow with full API understanding."""

    ai_model = config.get("ai_model", "gpt-4o")
    api_key = config.get("openai_api_key") or app_config.OPENAI_API_KEY

    if not api_key:
        logger.warning("[N8nAdapter] No OpenAI key available, skipping AI generation")
        return None

    method = config.get("http_method", "GET").upper()
    query_param = config.get("query_param", "")
    limit_param = config.get("limit_param", "")
    has_auth = bool(config.get("api_key") or config.get("headers"))

    # Build detailed API structure description for the AI
    response_desc = _describe_response_structure(probe, analysis)

    # Generate proven JS code for the main Code node
    js_code = _generate_fallback_js(api_url, config, analysis)
    js_code_escaped = json.dumps(js_code)

    sample_item_json = json.dumps(analysis.get("sample_item") or {}, indent=2, default=str)[:800]
    empty_response = json.dumps({"items": [], "count": 0, "topic": ""})

    user_prompt = f"""Generate an n8n workflow for this API. I will first explain the API structure in detail so you understand it fully before generating.

## Workflow Config
- **Workflow name:** {name}
- **Webhook path:** {webhook_path}
- **Webhook receives POST body:** {{"topic": "search query", "limit": 10}}

## Target API Details
- **URL:** {api_url}
- **HTTP Method:** {method}
- **Query param for search/topic:** {query_param or 'none'}
- **Query param for limit:** {limit_param or 'none'}
- **Auth required:** {has_auth}
{f'- **Auth:** Bearer token in Authorization header' if config.get('api_key') else ''}

## API Response Structure (THIS IS CRITICAL -- understand this before generating)

{response_desc}

## Sample API Response (actual data from probing the API):
```json
{probe['sample'][:2000]}
```

## Sample Item (after extracting and unwrapping from response):
```json
{sample_item_json}
```

## Field Mapping:
- title field: `{analysis.get('title_key') or 'NOT FOUND -- use first string field'}`
- description field: `{analysis.get('desc_key') or 'NOT FOUND -- use body/text/summary if available'}`
- url field: `{analysis.get('url_key') or 'NOT FOUND -- construct from other fields'}`
- date field: `{analysis.get('date_key') or 'NOT FOUND -- use current date'}`
- All item keys: {analysis.get('item_keys', [])[:25]}

## IMPORTANT: Use this EXACT JavaScript code for the "Fetch and Process" Code node:
{js_code_escaped}

This JS code has been specifically written to handle this API's response structure. Do NOT modify it.

## Required Workflow Structure (6 nodes):
1. **Webhook** (name="Webhook") -- httpMethod: "POST", path: "{webhook_path}", responseMode: "responseNode"
2. **Set Variables** (name="Set Variables", type=set) -- Set: topic="={{{{$json.body.topic || ''}}}}", limit="={{{{$json.body.limit || 10}}}}", source="{name}"
3. **Fetch and Process** (name="Fetch and Process", type=code) -- USE THE EXACT jsCode ABOVE
4. **Check Results** (name="Check Results", type=if) -- condition: leftValue="={{{{$json.count}}}}" operator type="number" operation="gt" rightValue="0"
5. **Respond with Data** (name="Respond with Data", type=respondToWebhook) -- respondWith: "json", responseBody: "={{{{JSON.stringify($json)}}}}"
6. **Respond Empty** (name="Respond Empty", type=respondToWebhook) -- respondWith: "json", responseBody: "={{{{{empty_response}}}}}"

## Connections:
Webhook -> Set Variables -> Fetch and Process -> Check Results
Check Results output 0 (true) -> Respond with Data
Check Results output 1 (false) -> Respond Empty

Generate unique UUIDs for all node IDs and webhookId. Return ONLY the complete workflow JSON."""

    try:
        client = openai.OpenAI(api_key=api_key)
        logger.info("[N8nAdapter] Calling %s to generate workflow...", ai_model)

        resp = client.chat.completions.create(
            model=ai_model,
            messages=[
                {"role": "system", "content": _WORKFLOW_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_completion_tokens=4096,
        )

        content = resp.choices[0].message.content.strip()

        # Strip markdown fences if present
        if content.startswith("```"):
            first_newline = content.index("\n")
            content = content[first_newline + 1:]
        if content.endswith("```"):
            content = content[:-3].strip()

        workflow = json.loads(content)

        # Validate minimum structure
        if "nodes" not in workflow or "connections" not in workflow:
            logger.warning("[N8nAdapter] AI workflow missing nodes/connections")
            return None

        workflow.setdefault("settings", {"executionOrder": "v1"})
        workflow["name"] = name

        # Ensure all nodes have id and webhook has webhookId
        for node in workflow.get("nodes", []):
            if not node.get("id"):
                node["id"] = str(uuid.uuid4())
            if node.get("type") == "n8n-nodes-base.webhook" and not node.get("webhookId"):
                node["webhookId"] = str(uuid.uuid4())

        node_types = [n.get("type", "?").split(".")[-1] for n in workflow.get("nodes", [])]
        logger.info(
            "[N8nAdapter] AI generated workflow: %d nodes [%s]",
            len(workflow["nodes"]), " -> ".join(node_types),
        )

        return workflow

    except json.JSONDecodeError as exc:
        logger.warning("[N8nAdapter] AI returned invalid JSON: %s", exc)
        return None
    except Exception as exc:
        logger.warning("[N8nAdapter] AI workflow generation failed: %s", exc)
        return None


def _build_fallback_workflow(name: str, webhook_path: str, js_code: str) -> dict:
    """Fallback: build a simple 3-node workflow if AI generation fails."""
    webhook_id = str(uuid.uuid4())
    return {
        "name": name,
        "nodes": [
            {
                "parameters": {
                    "httpMethod": "POST",
                    "path": webhook_path,
                    "responseMode": "responseNode",
                    "options": {},
                },
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2.1,
                "position": [0, 300],
                "id": str(uuid.uuid4()),
                "webhookId": webhook_id,
            },
            {
                "parameters": {"jsCode": js_code},
                "name": "Fetch Data",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [300, 300],
                "id": str(uuid.uuid4()),
            },
            {
                "parameters": {
                    "respondWith": "json",
                    "responseBody": "={{ JSON.stringify($json) }}",
                    "options": {},
                },
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1.4,
                "position": [600, 300],
                "id": str(uuid.uuid4()),
            },
        ],
        "connections": {
            "Webhook": {"main": [[{"node": "Fetch Data", "type": "main", "index": 0}]]},
            "Fetch Data": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        },
        "settings": {"executionOrder": "v1"},
    }


def _generate_fallback_js(api_url: str, config: dict[str, Any], analysis: dict) -> str:
    """Generate Code node JS that fetches and processes the API response.

    This code runs inside n8n's Code node and uses this.helpers.httpRequest().
    It handles nested response structures (like Reddit's data.children[].data).
    """
    method = config.get("http_method", "GET").upper()
    headers_entries = ["'User-Agent': 'ScoutBot/1.0'"]
    if config.get("api_key"):
        headers_entries.append(f"'Authorization': 'Bearer {config['api_key']}'")
    for k, v in (config.get("headers") or {}).items():
        headers_entries.append(f"'{k}': '{v}'")
    headers_js = "{" + ", ".join(headers_entries) + "}"

    param_name = config.get("query_param", "")
    limit_param = config.get("limit_param", "")

    if method == "GET" and (param_name or limit_param):
        url_parts = [f"'{api_url}'"]
        query_parts = []
        if param_name:
            query_parts.append(f"'{param_name}=' + encodeURIComponent(topic)")
        if limit_param:
            query_parts.append(f"'{limit_param}=' + limit")
        separator = "'?'" if "?" not in api_url else "'&'"
        fetch_url = f"{url_parts[0]} + {separator} + " + " + '&' + ".join(query_parts)
    else:
        fetch_url = f"'{api_url}'"

    body_js = ""
    if method == "POST":
        request_body = config.get("request_body", {})
        body_js = f",\n      body: {json.dumps(request_body, default=str)}"

    title_key = analysis.get("title_key") or "title"
    desc_key = analysis.get("desc_key") or "description"
    url_key = analysis.get("url_key") or "url"
    date_key = analysis.get("date_key") or "published_at"
    nested_path = analysis.get("nested_path")
    item_unwrap = analysis.get("item_unwrap")

    # Build the extraction code based on the analysis
    if nested_path and "." in nested_path:
        # Nested structure like "data.children"
        parts = nested_path.split(".")
        extract = f"let items = (resp && resp.{parts[0]} && resp.{parts[0]}.{parts[1]}) ? resp.{parts[0]}.{parts[1]} : [];"
        if item_unwrap:
            extract += f"\nitems = items.map(item => (item && item.{item_unwrap} && typeof item.{item_unwrap} === 'object') ? item.{item_unwrap} : item);"
    elif analysis.get("list_key"):
        list_key = analysis["list_key"]
        extract = f"let items = (resp && resp.{list_key}) ? resp.{list_key} : [];"
    elif analysis.get("is_array"):
        extract = "let items = Array.isArray(resp) ? resp : [];"
    else:
        # Generic smart extraction
        extract = """let items = [];
if (Array.isArray(resp)) { items = resp; }
else if (resp && typeof resp === 'object') {
  for (const key of ['data', 'results', 'items', 'entries', 'records', 'articles', 'posts', 'hits', 'stories', 'docs', 'feed', 'children']) {
    if (Array.isArray(resp[key])) { items = resp[key]; break; }
  }
  if (items.length === 0 && resp.data && typeof resp.data === 'object') {
    for (const key of ['children', 'items', 'results', 'entries', 'posts', 'data']) {
      if (Array.isArray(resp.data[key])) { items = resp.data[key]; break; }
    }
  }
  if (items.length === 0) items = [resp];
}
items = items.map(item => (item && item.data && typeof item.data === 'object' && (item.data.title || item.data.name)) ? item.data : item);"""

    return f"""
// Read input — works after both Set Variables node and directly after Webhook
const input = $input.first().json;
const topic = input.topic || (input.body ? input.body.topic : '') || '';
const limit = parseInt(input.limit || (input.body ? input.body.limit : 10)) || 10;

let resp;
try {{
  resp = await this.helpers.httpRequest({{
    method: '{method}',
    url: {fetch_url},
    headers: {headers_js}{body_js}
  }});
}} catch (err) {{
  return [{{ json: {{ items: [], count: 0, topic: topic, error: String(err.message || err) }} }}];
}}

if (typeof resp === 'string') {{
  try {{ resp = JSON.parse(resp); }} catch(e) {{
    return [{{ json: {{ items: [], count: 0, topic: topic, error: 'Non-JSON response: ' + resp.substring(0, 200) }} }}];
  }}
}}

{extract}

const topicLower = topic.toLowerCase();
const keywords = topicLower.split(' ').filter(k => k.length > 1);

const mapped = items.slice(0, limit * 2).filter(entry => {{
  if (!topic || topic === 'all') return true;
  const text = JSON.stringify(entry).toLowerCase();
  return keywords.some(kw => text.includes(kw));
}}).slice(0, limit).map(entry => ({{
  title: String(entry['{title_key}'] || entry.title || entry.name || 'Untitled'),
  description: String(entry['{desc_key}'] || entry.description || entry.summary || entry.selftext || entry.body || '').substring(0, 2000),
  url: String(entry['{url_key}'] || entry.url || entry.link || entry.html_url || entry.permalink || ''),
  published_at: String(entry['{date_key}'] || entry.published_at || entry.created_at || new Date().toISOString()),
  source: '{config.get("label", "n8n Scout")}'
}}));

return [{{ json: {{ items: mapped, count: mapped.length, topic: topic }} }}];
""".strip()


# ── Public Setup Function (called by API endpoint) ───────────────────────

def setup_n8n_workflow(source_config: dict[str, Any]) -> dict[str, Any]:
    """
    Called when a new n8n source is created.
    Probes the API, asks AI to generate the workflow, creates it in n8n.
    Returns {workflow_id, webhook_path, node_count, node_types} or raises.
    """
    api_url = source_config.get("api_url", "")
    n8n_host = source_config.get("n8n_host", "").rstrip("/")
    n8n_api_key = source_config.get("n8n_api_key", "")
    label = source_config.get("label", "n8n Scout")

    if not api_url or not n8n_host or not n8n_api_key:
        raise ValueError("api_url, n8n_host, and n8n_api_key are required")

    webhook_path = source_config.get("n8n_webhook_path") or _make_webhook_path(label)
    wf_name = f"Scout: {label}"

    n8n_api = httpx.Client(
        base_url=n8n_host,
        headers={"X-N8N-API-KEY": n8n_api_key},
        timeout=60,
    )

    # Check if workflow already exists
    try:
        resp = n8n_api.get("/api/v1/workflows", params={"limit": 50})
        if resp.status_code < 400:
            for wf in resp.json().get("data", []):
                if wf.get("name") == wf_name:
                    wf_id = str(wf["id"])
                    logger.info("[N8nSetup] Workflow already exists: %s (%s)", wf_id, wf_name)
                    n8n_api.post(f"/api/v1/workflows/{wf_id}/activate")
                    return {
                        "workflow_id": wf_id,
                        "webhook_path": webhook_path,
                        "status": "existing",
                    }
    except Exception:
        pass

    # Step 1: Probe the API
    logger.info("[N8nSetup] Probing API: %s", api_url)
    probe = _probe_api(api_url, source_config)
    logger.info(
        "[N8nSetup] Probe: status=%d json=%s sample=%d chars",
        probe["status_code"], probe["is_json"], len(probe["sample"]),
    )

    # Step 2: Analyze response structure
    analysis = _analyze_api_response(probe)
    logger.info(
        "[N8nSetup] Analysis: type=%s nested_path=%s unwrap=%s title=%s desc=%s url=%s date=%s keys=%s",
        analysis.get("response_type"), analysis.get("nested_path"),
        analysis.get("item_unwrap"), analysis.get("title_key"),
        analysis.get("desc_key"), analysis.get("url_key"),
        analysis.get("date_key"), analysis.get("item_keys", [])[:10],
    )

    # Step 3: Ask AI to generate the full workflow
    payload = _ai_generate_workflow(
        wf_name, webhook_path, api_url, source_config, probe, analysis,
    )

    generation_method = "ai"
    if payload is None:
        # Fallback to template-based workflow
        logger.info("[N8nSetup] AI generation failed, using fallback template")
        generation_method = "fallback"
        js_code = _generate_fallback_js(api_url, source_config, analysis)
        payload = _build_fallback_workflow(wf_name, webhook_path, js_code)

    # Step 4: Create the workflow in n8n
    logger.info("[N8nSetup] Creating workflow in n8n: %s", wf_name)
    resp = n8n_api.post("/api/v1/workflows", json=payload)
    if resp.status_code >= 400:
        error_text = resp.text[:500]
        logger.error("[N8nSetup] Create failed: %d %s", resp.status_code, error_text)
        raise RuntimeError(f"n8n workflow creation failed: {error_text}")

    wf = resp.json()
    wf_id = str(wf.get("id", ""))
    logger.info("[N8nSetup] Workflow created: id=%s", wf_id)

    # Step 5: Activate it
    act_resp = n8n_api.post(f"/api/v1/workflows/{wf_id}/activate")
    active = act_resp.json().get("active", False) if act_resp.status_code < 400 else False
    logger.info("[N8nSetup] Workflow %s active=%s", wf_id, active)

    node_types = [n.get("type", "?").split(".")[-1] for n in payload.get("nodes", [])]

    return {
        "workflow_id": wf_id,
        "webhook_path": webhook_path,
        "active": active,
        "generation_method": generation_method,
        "node_count": len(payload.get("nodes", [])),
        "node_types": node_types,
    }


class N8nAdapter(BaseAdapter):
    """Smart n8n scout adapter that auto-creates workflows from any API.

    Flow:
      1. Probe the given API URL to understand its response format
      2. Ask AI (GPT) to generate a multi-node n8n workflow
      3. Create the workflow in n8n, activate it
      4. Trigger the webhook to fetch and return items

    Required config:
      - n8n_host: n8n instance URL
      - n8n_api_key: n8n API token
      - api_url: the API endpoint to fetch data from
    """

    def fetch(self, topic: str, limit: int, config: dict[str, Any]) -> list[RawItem]:
        n8n_host = config.get("n8n_host", "").rstrip("/")
        n8n_api_key = config.get("n8n_api_key", "")
        api_url = config.get("api_url", "")

        if not n8n_host or not n8n_api_key:
            raise ValueError("n8n source requires 'n8n_host' and 'n8n_api_key' in config")
        if not api_url:
            raise ValueError("n8n source requires 'api_url' in config")

        label = config.get("label", "n8n Scout")
        logger.info(
            "[N8nAdapter] api_url=%s topic=%r limit=%d host=%s",
            api_url, topic, limit, n8n_host,
        )

        n8n_api = httpx.Client(
            base_url=n8n_host,
            headers={"X-N8N-API-KEY": n8n_api_key},
            timeout=60,
        )

        # Ensure workflow exists -- setup on demand if not created yet
        webhook_path = config.get("n8n_webhook_path") or _make_webhook_path(label)
        wf_name = f"Scout: {label}"

        # Always check if the workflow actually exists in n8n (may have been deleted)
        existing_id = self._find_existing_workflow(n8n_api, wf_name)
        if existing_id:
            logger.info("[N8nAdapter] Found existing workflow %s (%s)", existing_id, wf_name)
            self._activate_workflow(n8n_api, existing_id)
        else:
            # Auto-setup (probe + AI generate + create + activate)
            logger.info("[N8nAdapter] No workflow found, auto-creating with AI...")
            result = setup_n8n_workflow(config)
            existing_id = result["workflow_id"]
            webhook_path = result["webhook_path"]

        # Trigger the webhook
        webhook_url = f"{n8n_host}/webhook/{webhook_path}"
        logger.info("[N8nAdapter] Triggering webhook: POST %s", webhook_url)

        data = None
        last_exc = None
        for attempt in range(4):
            try:
                if attempt > 0:
                    wait = 3 * attempt
                    logger.info("[N8nAdapter] Retry %d -- waiting %ds for webhook...", attempt, wait)
                    time.sleep(wait)
                resp = httpx.post(
                    webhook_url,
                    json={"topic": topic, "limit": limit},
                    timeout=90,
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                if exc.response.status_code == 404 and attempt < 3:
                    logger.warning("[N8nAdapter] Webhook 404 on attempt %d, will retry...", attempt + 1)
                    continue
                logger.error(
                    "[N8nAdapter] Webhook HTTP %d: %s",
                    exc.response.status_code, exc.response.text[:500],
                )
                raise
            except Exception as exc:
                logger.exception("[N8nAdapter] Webhook error: %s", exc)
                raise

        if data is None:
            raise last_exc or RuntimeError("Webhook call failed after retries")

        # Parse response
        items_data = data.get("items", [])
        logger.info(
            "[N8nAdapter] Webhook returned %d items (topic=%s)",
            len(items_data), data.get("topic", topic),
        )

        return self._map_items(items_data, limit, config)

    # ── Helpers ───────────────────────────────────────────────────────────

    def _activate_workflow(self, n8n_api: httpx.Client, workflow_id: str) -> bool:
        try:
            resp = n8n_api.post(f"/api/v1/workflows/{workflow_id}/activate")
            if resp.status_code < 400:
                active = resp.json().get("active", False)
                logger.info("[N8nAdapter] Workflow %s active=%s", workflow_id, active)
                return active
        except Exception as exc:
            logger.warning("[N8nAdapter] Activate error: %s", exc)
        return False

    def _find_existing_workflow(self, n8n_api: httpx.Client, name: str) -> str | None:
        try:
            resp = n8n_api.get("/api/v1/workflows", params={"limit": 50})
            if resp.status_code < 400:
                for wf in resp.json().get("data", []):
                    if wf.get("name") == name:
                        return str(wf["id"])
        except Exception:
            pass
        return None

    def _map_items(
        self, items_data: list[dict], limit: int, config: dict[str, Any],
    ) -> list[RawItem]:
        source_label = config.get("label", "n8n")
        now = datetime.now(timezone.utc).isoformat()
        items: list[RawItem] = []

        for entry in items_data[:limit]:
            title = (
                entry.get("title")
                or entry.get("name")
                or entry.get("id")
                or "Untitled"
            )
            snippet = (
                entry.get("description")
                or entry.get("summary")
                or entry.get("abstract")
                or entry.get("body")
                or ""
            )
            url = entry.get("url") or entry.get("link") or entry.get("html_url") or ""
            published = entry.get("published_at") or entry.get("created_at") or now

            metadata = {}
            for key in ("score", "comments", "author", "source", "likes",
                        "downloads", "stars", "forks"):
                if key in entry:
                    metadata[key] = entry[key]

            items.append(
                RawItem(
                    title=str(title),
                    snippet=str(snippet)[:2000],
                    url=str(url),
                    source_label=source_label,
                    published_at=str(published),
                    item_type="update",
                    metadata=metadata,
                )
            )

        return items
