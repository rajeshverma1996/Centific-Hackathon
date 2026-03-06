from __future__ import annotations

import logging
import time
from typing import Any

import httpx

import config as app_config
from scout.formatter import Formatter, FormattedItem
from scout.adapters.base import BaseAdapter, RawItem
from scout.adapters.arxiv_adapter import ArxivAdapter
from scout.adapters.hf_adapter import HuggingFaceAdapter
from scout.adapters.custom_api_adapter import CustomApiAdapter
from scout.adapters.web_search_adapter import WebSearchAdapter
from scout.adapters.n8n_adapter import N8nAdapter

logger = logging.getLogger(__name__)

ADAPTER_MAP: dict[str, type[BaseAdapter]] = {
    "arxiv": ArxivAdapter,
    "huggingface": HuggingFaceAdapter,
    "custom_api": CustomApiAdapter,
    "web_search": WebSearchAdapter,
    "n8n": N8nAdapter,
}

FETCH_MULTIPLIER = 5


class ScoutService:
    def __init__(self) -> None:
        self.formatter = Formatter()
        self._http = httpx.Client(
            base_url=app_config.BACKEND_URL,
            headers={"X-Scout-Key": app_config.SCOUT_API_KEY},
            timeout=60,
        )
        logger.info(
            "[ScoutService] Initialized — backend=%s adapters=%s",
            app_config.BACKEND_URL,
            list(ADAPTER_MAP.keys()),
        )

    # ── Public API ───────────────────────────────────────────────────────

    def run_all(self) -> dict[str, Any]:
        """Run scouts for every active source."""
        logger.info("=" * 60)
        logger.info("[ScoutService] === STARTING FULL SCOUT RUN ===")
        logger.info("=" * 60)

        start = time.time()
        sources = self._fetch_sources()
        logger.info("[ScoutService] Found %d active scout sources", len(sources))

        summary: dict[str, Any] = {"total_sources": len(sources), "results": []}

        for idx, source in enumerate(sources, 1):
            label = source.get("label", source.get("type", "?"))
            logger.info(
                "[ScoutService] --- Source %d/%d: %s (type=%s, id=%s) ---",
                idx, len(sources), label, source.get("type"), source.get("id"),
            )
            result = self.run_one(source)
            summary["results"].append(result)

        elapsed = time.time() - start
        ok = sum(1 for r in summary["results"] if r.get("status") == "ok")
        failed = sum(1 for r in summary["results"] if r.get("status") == "error")
        skipped = sum(1 for r in summary["results"] if r.get("status") == "skipped")

        logger.info("=" * 60)
        logger.info(
            "[ScoutService] === SCOUT RUN COMPLETE in %.1fs — ok=%d failed=%d skipped=%d ===",
            elapsed, ok, failed, skipped,
        )
        logger.info("=" * 60)

        return summary

    def run_one(self, source: dict[str, Any]) -> dict[str, Any]:
        """Run a single scout source."""
        source_id = source["id"]
        source_type = source["type"]
        label = source.get("label", source_type)
        cfg: dict = source.get("config", {})
        cfg.setdefault("label", label)

        topic = cfg.get("topic", "")
        limit = cfg.get("items_per_day", 5)

        if not topic:
            logger.warning("[ScoutService] Source %s has no topic configured, SKIPPING", label)
            return {"source": label, "status": "skipped", "reason": "no topic"}

        adapter_cls = ADAPTER_MAP.get(source_type)
        if not adapter_cls:
            logger.warning("[ScoutService] Unknown source type '%s' for %s (available: %s), SKIPPING", source_type, label, list(ADAPTER_MAP.keys()))
            return {"source": label, "status": "skipped", "reason": f"unknown type {source_type}"}

        try:
            # Step 1: Fetch a larger pool of raw items (sorted by latest)
            fetch_pool = limit * FETCH_MULTIPLIER
            logger.info(
                "[ScoutService] [%s] Step 1/3: Fetching pool of %d raw items (need %d new, topic=%r)",
                label, fetch_pool, limit, topic,
            )
            step_start = time.time()
            adapter = adapter_cls()
            raw_items = adapter.fetch(topic, fetch_pool, cfg)
            logger.info(
                "[ScoutService] [%s] Step 1/3 done: fetched %d raw items in %.1fs",
                label, len(raw_items), time.time() - step_start,
            )

            if not raw_items:
                logger.info("[ScoutService] [%s] No items found, updating last_run_at", label)
                self._update_last_run(source_id)
                return {"source": label, "status": "ok", "fetched": 0, "ingested": 0}

            # Step 1b: Filter out items that already exist in the DB
            new_items = self._filter_new_items(raw_items, label)

            if not new_items:
                logger.info("[ScoutService] [%s] All %d items already exist, nothing new to ingest", label, len(raw_items))
                self._update_last_run(source_id)
                return {"source": label, "status": "ok", "fetched": len(raw_items), "ingested": 0, "all_duplicate": True}

            # Take only the number we need, prioritizing latest (already sorted by date desc)
            items_to_process = new_items[:limit]
            logger.info(
                "[ScoutService] [%s] Found %d new items out of %d, processing top %d (latest first)",
                label, len(new_items), len(raw_items), len(items_to_process),
            )

            # Step 2: Format with AI (only the new items — saves API tokens)
            ai_provider = cfg.get("ai_provider", "claude")
            ai_model = cfg.get("ai_model", "")
            logger.info(
                "[ScoutService] [%s] Step 2/3: Formatting %d NEW items with %s (%s)",
                label, len(items_to_process), ai_provider, ai_model or "default",
            )
            step_start = time.time()
            formatted = self.formatter.format_batch(items_to_process, source_config=cfg)
            logger.info(
                "[ScoutService] [%s] Step 2/3 done: formatted %d items in %.1fs",
                label, len(formatted), time.time() - step_start,
            )

            # Step 3: Ingest into backend
            logger.info("[ScoutService] [%s] Step 3/3: Ingesting %d items into backend", label, len(formatted))
            step_start = time.time()
            ingested = self._ingest(formatted, source_id)
            self._update_last_run(source_id)
            logger.info(
                "[ScoutService] [%s] Step 3/3 done: ingested %d items in %.1fs",
                label, ingested, time.time() - step_start,
            )

            return {"source": label, "status": "ok", "fetched": len(raw_items), "new": len(new_items), "ingested": ingested}

        except Exception as exc:
            logger.exception("[ScoutService] [%s] FAILED: %s", label, exc)
            return {"source": label, "status": "error", "error": str(exc)}

    def run_by_id(self, source_id: str) -> dict[str, Any]:
        """Fetch a single source by ID and run it."""
        logger.info("[ScoutService] Running single source id=%s", source_id)
        sources = self._fetch_sources()
        for s in sources:
            if s["id"] == source_id:
                return self.run_one(s)
        logger.warning("[ScoutService] Source id=%s not found or not active", source_id)
        return {"status": "error", "error": f"Source {source_id} not found or not active"}

    # ── Internal helpers ─────────────────────────────────────────────────

    def _filter_new_items(self, raw_items: list[RawItem], label: str) -> list[RawItem]:
        """Check which items already exist in the DB by URL and filter them out."""
        urls = [item.url for item in raw_items if item.url]
        if not urls:
            return raw_items

        try:
            resp = self._http.post("/api/scout/check-urls", json={"urls": urls})
            resp.raise_for_status()
            existing: set[str] = set(resp.json().get("existing", []))
        except Exception as exc:
            logger.warning("[ScoutService] [%s] URL check failed, processing all items: %s", label, exc)
            return raw_items

        new_items = [item for item in raw_items if item.url not in existing]
        logger.info(
            "[ScoutService] [%s] URL dedup: %d total, %d already in DB, %d new",
            label, len(raw_items), len(existing), len(new_items),
        )
        return new_items

    def _fetch_sources(self) -> list[dict]:
        logger.debug("[ScoutService] Fetching scout sources from backend...")
        try:
            resp = self._http.get("/api/scout/sources")
            resp.raise_for_status()
            sources = resp.json().get("data", [])
            logger.debug("[ScoutService] Backend returned %d sources", len(sources))
            return sources
        except httpx.HTTPStatusError as exc:
            logger.error(
                "[ScoutService] Backend returned HTTP %d when fetching sources: %s",
                exc.response.status_code, exc.response.text[:300],
            )
            raise
        except httpx.ConnectError:
            logger.error(
                "[ScoutService] Cannot connect to backend at %s — is it running?",
                app_config.BACKEND_URL,
            )
            raise

    def _ingest(self, items: list[FormattedItem], source_id: str) -> int:
        payload = {
            "items": [
                {
                    "title": it.title,
                    "source_label": it.source_label,
                    "source_id": source_id,
                    "type": it.item_type,
                    "summary": it.description,
                    "url": it.url,
                    "metadata": it.metadata,
                    "published_at": it.published_at,
                }
                for it in items
            ]
        }

        try:
            resp = self._http.post("/api/scout/ingest", json=payload)
            resp.raise_for_status()
            body = resp.json()
            count = body.get("ingested", 0)
            skipped = body.get("skipped", 0)
            total = body.get("total", len(items))
            logger.info(
                "[ScoutService] Ingest result: %d new, %d duplicates skipped, %d total (source_id=%s)",
                count, skipped, total, source_id,
            )
            return count
        except httpx.HTTPStatusError as exc:
            logger.error(
                "[ScoutService] Ingest failed HTTP %d: %s",
                exc.response.status_code, exc.response.text[:500],
            )
            raise
        except Exception as exc:
            logger.exception("[ScoutService] Ingest error: %s", exc)
            raise

    def _update_last_run(self, source_id: str) -> None:
        try:
            resp = self._http.patch(f"/api/scout/sources/{source_id}/last-run")
            resp.raise_for_status()
            logger.debug("[ScoutService] Updated last_run_at for source %s", source_id)
        except Exception as exc:
            logger.warning("[ScoutService] Failed to update last_run_at for %s: %s", source_id, exc)
