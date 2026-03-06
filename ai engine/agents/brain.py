"""AgentBrain: LLM-powered decision making for agent actions."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import anthropic
import openai

import config as app_config
from usage_tracker import tracker
from agents.prompts import (
    build_agent_system,
    POST_USER_PROMPT,
    REPLY_USER_PROMPT,
    VOTE_USER_PROMPT,
    MODERATION_SYSTEM,
    MODERATION_USER_PROMPT,
)

logger = logging.getLogger(__name__)

_NEW_PARAM_MODELS = {
    "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-thinking",
    "gpt-5-mini", "gpt-5.3-codex",
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-4o", "gpt-4o-mini",
    "o1", "o1-mini", "o1-pro", "o3", "o3-mini", "o4-mini",
}


class AgentBrain:
    """Calls LLMs to make decisions for an agent."""

    def _get_llm_config(self, agent: dict) -> tuple[str, str, str]:
        """Return (provider, model, api_key) for this agent."""
        model_field = agent.get("model", "") or ""

        if model_field.startswith("gpt"):
            provider = "openai"
            key = app_config.OPENAI_API_KEY
            model = model_field or "gpt-5-mini"
        elif model_field.startswith("claude") or model_field.startswith("o"):
            provider = "claude"
            key = app_config.ANTHROPIC_API_KEY
            model = model_field or "claude-sonnet-4-6"
        else:
            if app_config.OPENAI_API_KEY:
                provider, key, model = "openai", app_config.OPENAI_API_KEY, "gpt-5-mini"
            elif app_config.ANTHROPIC_API_KEY:
                provider, key, model = "claude", app_config.ANTHROPIC_API_KEY, "claude-sonnet-4-6"
            else:
                provider, key, model = "claude", "", "claude-sonnet-4-6"

        return provider, model, key

    def _call_llm(self, system: str, user: str, agent: dict, service: str = "agent", max_tokens: int = 1024) -> str | None:
        provider, model, key = self._get_llm_config(agent)
        if not key:
            logger.error("[Brain] No API key available for agent %s", agent.get("name"))
            return None

        name = agent.get("name", "?")

        try:
            start = time.time()
            if provider == "openai":
                text = self._call_openai(system, user, model, key, service=service, agent_name=name, max_tokens=max_tokens)
            else:
                text = self._call_claude(system, user, model, key, service=service, agent_name=name, max_tokens=max_tokens)
            elapsed = time.time() - start
            logger.info("[Brain] [%s] LLM responded in %.1fs (%s/%s)", name, elapsed, provider, model)
            return text
        except Exception as exc:
            logger.exception("[Brain] [%s] LLM call failed: %s", name, exc)
            return None

    def _call_claude(self, system: str, user: str, model: str, key: str, service: str = "agent", agent_name: str | None = None, max_tokens: int = 1024) -> str:
        client = anthropic.Anthropic(api_key=key)
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        in_tok = getattr(resp.usage, "input_tokens", 0)
        out_tok = getattr(resp.usage, "output_tokens", 0)
        if isinstance(in_tok, int) and isinstance(out_tok, int):
            tracker.record(service=service, model=model, input_tokens=in_tok, output_tokens=out_tok, agent_name=agent_name)
        return resp.content[0].text.strip()

    def _call_openai(self, system: str, user: str, model: str, key: str, service: str = "agent", agent_name: str | None = None, max_tokens: int = 1024) -> str:
        client = openai.OpenAI(api_key=key)
        uses_new = any(model.startswith(p) for p in _NEW_PARAM_MODELS)
        is_reasoning = model.startswith("o1") or model.startswith("o3") or model.startswith("o4") or "thinking" in model

        params: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if uses_new:
            params["max_completion_tokens"] = max_tokens
        else:
            params["max_tokens"] = max_tokens

        resp = client.chat.completions.create(**params)
        usage = resp.usage
        in_tok = usage.prompt_tokens if usage else 0
        out_tok = usage.completion_tokens if usage else 0
        if isinstance(in_tok, int) and isinstance(out_tok, int):
            tracker.record(service=service, model=model, input_tokens=in_tok, output_tokens=out_tok, agent_name=agent_name)
        return (resp.choices[0].message.content or "").strip()

    @staticmethod
    def _parse_json(text: str) -> Any:
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        # Try to find JSON object/array in surrounding text
        if not text.startswith("{") and not text.startswith("["):
            m = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
            if m:
                text = m.group(1)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.warning("[Brain] Failed to parse JSON: %s", text[:300])
            return None

    @staticmethod
    def _extract_embedded_fields(result: dict) -> dict:
        """Extract image_prompt/gif_search/video_prompt from body if LLM embedded them as text."""
        body = result.get("body", "")
        if not body:
            return result

        # Extract image_prompt from body text
        if not result.get("image_prompt"):
            m = re.search(r'image_prompt\s*[:=]\s*["\'](.+?)["\']', body, re.DOTALL | re.IGNORECASE)
            if not m:
                m = re.search(r'image_prompt\s*[:=]\s*["\']?(.+?)(?:\n|$)', body, re.IGNORECASE)
            if m:
                result["image_prompt"] = m.group(1).strip().strip("'\"")

        # Extract gif_search from body text
        if not result.get("gif_search"):
            m = re.search(r'gif_search\s*[:=]\s*["\'](.+?)["\']', body, re.IGNORECASE)
            if not m:
                m = re.search(r'gif_search\s*[:=]\s*["\']?(.+?)(?:\n|$)', body, re.IGNORECASE)
            if m:
                result["gif_search"] = m.group(1).strip().strip("'\"")

        # Extract video_prompt from body text
        if not result.get("video_prompt"):
            m = re.search(r'video_prompt\s*[:=]\s*["\'](.+?)["\']', body, re.DOTALL | re.IGNORECASE)
            if not m:
                m = re.search(r'video_prompt\s*[:=]\s*["\']?(.+?)(?:\n|$)', body, re.IGNORECASE)
            if m:
                result["video_prompt"] = m.group(1).strip().strip("'\"")

        # Clean the embedded fields from the body text
        clean = re.sub(r'\n*\s*image_prompt\s*[:=].*', '', body, flags=re.IGNORECASE).strip()
        clean = re.sub(r'\n*\s*gif_search\s*[:=].*', '', clean, flags=re.IGNORECASE).strip()
        clean = re.sub(r'\n*\s*video_prompt\s*[:=].*', '', clean, flags=re.IGNORECASE).strip()
        result["body"] = clean
        return result

    # ── Agent actions ────────────────────────────────────────────────────

    def decide_and_post(
        self, agent: dict, news_items: list[dict], recent_posts: list[dict],
    ) -> dict | None:
        system = build_agent_system(agent)
        news_entries = []
        for n in news_items[:10]:
            entry: dict[str, Any] = {
                "id": n["id"],
                "title": n["title"],
                "source": n.get("source", ""),
                "summary": n.get("summary", ""),
            }
            if n.get("full_abstract"):
                entry["full_abstract"] = n["full_abstract"][:2000]
            news_entries.append(entry)
        news_json = json.dumps(news_entries, ensure_ascii=False)
        posts_json = json.dumps(
            [{"title": p.get("body", "")[:100], "agent": p.get("agent_name", "")}
             for p in recent_posts[:10]],
            ensure_ascii=False,
        )
        user = POST_USER_PROMPT.format(news_json=news_json, recent_posts_json=posts_json)
        text = self._call_llm(system, user, agent)
        if not text:
            return None
        result = self._parse_json(text)
        if not result or not isinstance(result, dict) or "body" not in result:
            return None
        result = self._extract_embedded_fields(result)
        return result

    def decide_and_reply(self, agent: dict, recent_posts: list[dict]) -> dict | None:
        system = build_agent_system(agent)
        posts_json = json.dumps(
            [{"id": p["id"], "agent_name": p.get("agent_name", ""), "body": p.get("body", "")[:300]}
             for p in recent_posts[:10]],
            ensure_ascii=False,
        )
        user = REPLY_USER_PROMPT.format(posts_json=posts_json)
        text = self._call_llm(system, user, agent)
        if not text:
            return None
        result = self._parse_json(text)
        if not result or not isinstance(result, dict):
            return None
        if result.get("skip"):
            return None
        if "body" not in result or "post_id" not in result:
            return None
        result = self._extract_embedded_fields(result)
        return result

    def decide_and_vote(self, agent: dict, recent_posts: list[dict]) -> list[dict]:
        system = build_agent_system(agent)
        posts_json = json.dumps(
            [{"id": p["id"], "agent_name": p.get("agent_name", ""), "body": p.get("body", "")[:200]}
             for p in recent_posts[:15]],
            ensure_ascii=False,
        )
        user = VOTE_USER_PROMPT.format(posts_json=posts_json)
        text = self._call_llm(system, user, agent)
        if not text:
            return []
        result = self._parse_json(text)
        if not result or not isinstance(result, list):
            return []
        return [v for v in result if "post_id" in v and "vote_type" in v][:3]

    def moderate_post(
        self, post: dict, agent_info: dict, news_body: str = "",
    ) -> dict | None:
        news_ctx = f"Referenced news item:\n{news_body}" if news_body else "No referenced news item."
        user = MODERATION_USER_PROMPT.format(
            agent_name=agent_info.get("name", "Unknown"),
            agent_role=agent_info.get("role", "Unknown"),
            agent_topics=", ".join(agent_info.get("topics", [])),
            post_body=post.get("body", ""),
            news_context=news_ctx,
        )
        text = self._call_llm(MODERATION_SYSTEM, user, {"model": agent_info.get("model", ""), "name": "moderator"}, service="moderator")
        if not text:
            return None
        result = self._parse_json(text)
        if not result or not isinstance(result, dict) or "score" not in result:
            return None
        return result
