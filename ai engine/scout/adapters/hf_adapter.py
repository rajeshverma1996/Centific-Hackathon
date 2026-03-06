from __future__ import annotations

import logging
from typing import Any
from datetime import datetime, timezone

from huggingface_hub import HfApi

from .base import BaseAdapter, RawItem

logger = logging.getLogger(__name__)


def _format_number(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def _dt_to_iso(val: Any) -> str:
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val) if val else datetime.now(timezone.utc).isoformat()


class HuggingFaceAdapter(BaseAdapter):
    """Fetches models, datasets, spaces, papers, or benchmark leaderboards
    from the Hugging Face Hub.

    Supported hf_type values (set via source config):
      - "model" (default): search models by topic, sorted by lastModified
      - "dataset": search datasets by topic
      - "benchmark": top-performing models ranked by likes/downloads with leaderboard table
      - "paper" / "daily_paper": latest daily papers from HF
      - "space": trending/top spaces
    """

    def fetch(self, topic: str, limit: int, config: dict[str, Any]) -> list[RawItem]:
        token = config.get("hf_token") or None
        hf_type = config.get("hf_type", "model")

        logger.info(
            "[HuggingFaceAdapter] Fetching type=%s topic=%r limit=%d token=%s",
            hf_type, topic, limit, "provided" if token else "none",
        )

        api = HfApi(token=token)

        if hf_type == "dataset":
            return self._fetch_datasets(api, topic, limit)
        elif hf_type == "benchmark":
            return self._fetch_benchmark(api, topic, limit, config)
        elif hf_type in ("paper", "daily_paper"):
            return self._fetch_daily_papers(api, topic, limit)
        elif hf_type == "space":
            return self._fetch_spaces(api, topic, limit)
        return self._fetch_models(api, topic, limit)

    # ── Models ────────────────────────────────────────────────────────────

    def _fetch_models(self, api: HfApi, topic: str, limit: int) -> list[RawItem]:
        logger.debug("[HuggingFaceAdapter] Searching models: %r", topic)
        models = list(api.list_models(search=topic, limit=limit, sort="lastModified"))
        logger.info("[HuggingFaceAdapter] Found %d models", len(models))

        items: list[RawItem] = []
        for m in models:
            items.append(
                RawItem(
                    title=m.modelId or "Untitled Model",
                    snippet=getattr(m, "pipeline_tag", "") or "",
                    url=f"https://huggingface.co/{m.modelId}",
                    source_label="Hugging Face",
                    published_at=_dt_to_iso(m.lastModified),
                    item_type="model",
                    metadata={
                        "downloads": getattr(m, "downloads", 0),
                        "likes": getattr(m, "likes", 0),
                        "pipeline_tag": getattr(m, "pipeline_tag", None),
                        "tags": list(getattr(m, "tags", []))[:10],
                    },
                )
            )
        return items

    # ── Datasets ──────────────────────────────────────────────────────────

    def _fetch_datasets(self, api: HfApi, topic: str, limit: int) -> list[RawItem]:
        logger.debug("[HuggingFaceAdapter] Searching datasets: %r", topic)
        datasets = list(api.list_datasets(search=topic, limit=limit, sort="lastModified"))
        logger.info("[HuggingFaceAdapter] Found %d datasets", len(datasets))

        items: list[RawItem] = []
        for d in datasets:
            items.append(
                RawItem(
                    title=d.id or "Untitled Dataset",
                    snippet=getattr(d, "description", "") or "",
                    url=f"https://huggingface.co/datasets/{d.id}",
                    source_label="Hugging Face",
                    published_at=_dt_to_iso(d.lastModified),
                    item_type="dataset",
                    metadata={
                        "downloads": getattr(d, "downloads", 0),
                        "likes": getattr(d, "likes", 0),
                        "tags": list(getattr(d, "tags", []))[:10],
                    },
                )
            )
        return items

    # ── Benchmark Leaderboard ─────────────────────────────────────────────

    def _fetch_benchmark(self, api: HfApi, topic: str, limit: int, config: dict[str, Any]) -> list[RawItem]:
        """Fetch top-performing models sorted by likes/downloads with leaderboard table."""
        sort_by = config.get("sort_by", "likes")
        pipeline_filter = config.get("pipeline_filter", "text-generation")

        logger.info(
            "[HuggingFaceAdapter] Benchmark mode: sort=%s pipeline=%s",
            sort_by, pipeline_filter,
        )

        fetch_count = max(limit * 4, 20)
        models = list(api.list_models(
            search=None,
            limit=fetch_count,
            sort=sort_by,
            pipeline_tag=pipeline_filter if pipeline_filter else None,
        ))
        logger.info("[HuggingFaceAdapter] Benchmark: found %d models", len(models))

        if not models:
            return []

        now = datetime.now(timezone.utc)

        # Build leaderboard table
        table_lines = [
            "| Rank | Model | Downloads | Likes | Pipeline |",
            "|------|-------|-----------|-------|----------|",
        ]
        for i, m in enumerate(models[:20]):
            model_id = m.modelId or "Unknown"
            display = model_id if len(model_id) <= 45 else model_id[:42] + "..."
            dl = _format_number(getattr(m, "downloads", 0))
            lk = _format_number(getattr(m, "likes", 0))
            pipe = getattr(m, "pipeline_tag", "-") or "-"
            table_lines.append(f"| {i+1} | {display} | {dl} | {lk} | {pipe} |")
        table = "\n".join(table_lines)

        items: list[RawItem] = []

        # Main leaderboard summary
        top_model = models[0].modelId or "Unknown"
        items.append(
            RawItem(
                title=f"Top AI Models Leaderboard ({now.strftime('%b %Y')})",
                snippet=(
                    f"Top performing models on HuggingFace ranked by {sort_by}. "
                    f"#1 is {top_model}.\n\n{table}"
                ),
                url="https://huggingface.co/models?sort=likes&pipeline_tag=text-generation",
                source_label="HuggingFace Benchmarks",
                published_at=now.isoformat(),
                item_type="benchmark",
                metadata={
                    "top_model": top_model,
                    "total_ranked": len(models),
                    "sort_by": sort_by,
                    "benchmark_table": table,
                },
            )
        )

        # Individual top model items
        for i, m in enumerate(models[:limit]):
            downloads = getattr(m, "downloads", 0)
            likes = getattr(m, "likes", 0)
            pipeline_tag = getattr(m, "pipeline_tag", "") or ""

            snippet = (
                f"Rank #{i+1} | Pipeline: {pipeline_tag} | "
                f"Downloads: {_format_number(downloads)} | Likes: {_format_number(likes)}"
            )

            items.append(
                RawItem(
                    title=f"{m.modelId} — #{i+1} Top Performing Model",
                    snippet=snippet,
                    url=f"https://huggingface.co/{m.modelId}",
                    source_label="HuggingFace Benchmarks",
                    published_at=_dt_to_iso(m.lastModified),
                    item_type="benchmark",
                    metadata={
                        "rank": i + 1,
                        "downloads": downloads,
                        "likes": likes,
                        "pipeline_tag": pipeline_tag,
                        "tags": list(getattr(m, "tags", []))[:15],
                    },
                )
            )

        return items

    # ── Daily Papers ──────────────────────────────────────────────────────

    def _fetch_daily_papers(self, api: HfApi, topic: str, limit: int) -> list[RawItem]:
        """Fetch the latest daily papers from HuggingFace."""
        logger.debug("[HuggingFaceAdapter] Fetching daily papers, topic=%r", topic)

        papers = list(api.list_daily_papers())
        logger.info("[HuggingFaceAdapter] Found %d daily papers", len(papers))

        # Filter by topic keyword if provided
        if topic:
            topic_lower = topic.lower()
            papers = [
                p for p in papers
                if topic_lower in (getattr(p, "title", "") or "").lower()
                or topic_lower in (getattr(p, "summary", "") or "").lower()
                or any(topic_lower in kw.lower() for kw in (getattr(p, "ai_keywords", []) or []))
            ]
            logger.info("[HuggingFaceAdapter] After topic filter: %d papers", len(papers))

        items: list[RawItem] = []
        for p in papers[:limit]:
            title = getattr(p, "title", "Untitled Paper") or "Untitled Paper"
            summary = getattr(p, "summary", "") or ""
            ai_summary = getattr(p, "ai_summary", "") or ""
            paper_id = getattr(p, "id", "")
            upvotes = getattr(p, "upvotes", 0)
            github_repo = getattr(p, "github_repo", None)
            github_stars = getattr(p, "github_stars", 0)
            published = getattr(p, "published_at", None)
            authors = getattr(p, "authors", []) or []
            ai_keywords = getattr(p, "ai_keywords", []) or []

            # Use ai_summary if available, fallback to regular summary
            snippet = ai_summary if ai_summary else summary[:500]
            if github_repo:
                snippet += f"\n\nGitHub: {github_repo} ({github_stars} stars)"

            url = f"https://huggingface.co/papers/{paper_id}" if paper_id else ""

            items.append(
                RawItem(
                    title=title,
                    snippet=snippet,
                    url=url,
                    source_label="HuggingFace Papers",
                    published_at=_dt_to_iso(published),
                    item_type="paper",
                    metadata={
                        "paper_id": paper_id,
                        "upvotes": upvotes,
                        "github_repo": github_repo,
                        "github_stars": github_stars,
                        "authors": [getattr(a, "name", str(a)) for a in authors[:5]] if authors else [],
                        "ai_keywords": ai_keywords[:10],
                    },
                )
            )

        return items

    # ── Spaces ────────────────────────────────────────────────────────────

    def _fetch_spaces(self, api: HfApi, topic: str, limit: int) -> list[RawItem]:
        """Fetch top/trending HuggingFace Spaces."""
        logger.debug("[HuggingFaceAdapter] Fetching spaces: topic=%r", topic)

        spaces = list(api.list_spaces(
            search=topic or None,
            limit=limit,
            sort="likes",
        ))
        logger.info("[HuggingFaceAdapter] Found %d spaces", len(spaces))

        items: list[RawItem] = []
        for s in spaces:
            space_id = s.id or "Unknown"
            likes = getattr(s, "likes", 0)
            sdk = getattr(s, "sdk", None) or ""
            last_modified = getattr(s, "lastModified", None)

            snippet = f"Likes: {_format_number(likes)}"
            if sdk:
                snippet += f" | SDK: {sdk}"
            tags = list(getattr(s, "tags", []))[:10]
            if tags:
                snippet += f" | Tags: {', '.join(tags[:5])}"

            items.append(
                RawItem(
                    title=f"{space_id} — HuggingFace Space",
                    snippet=snippet,
                    url=f"https://huggingface.co/spaces/{space_id}",
                    source_label="HuggingFace Spaces",
                    published_at=_dt_to_iso(last_modified),
                    item_type="space",
                    metadata={
                        "likes": likes,
                        "sdk": sdk,
                        "tags": tags,
                    },
                )
            )

        return items
