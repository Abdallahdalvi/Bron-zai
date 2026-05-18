"""
DOM Change Monitor - Detects whether an action had any observable effect on the page.

Computes a lightweight state hash from:
  - Current URL
  - Page title
  - Number of interactive elements (inputs, buttons, links)
  - Vertical scroll position

If the hash is identical before and after an action, the action had no effect.
The agent loop uses this to inject a mandatory reflection prompt rather than
blindly retrying the same failed action.
"""
import hashlib
from typing import Optional
from rich.console import Console

console = Console()

# JavaScript to extract a compact page fingerprint
_FINGERPRINT_SCRIPT = """
(function() {
    try {
        const url = window.location.href;
        const title = document.title || '';
        const inputCount = document.querySelectorAll('input, textarea, select').length;
        const buttonCount = document.querySelectorAll('button, [role="button"]').length;
        const linkCount = document.querySelectorAll('a[href]').length;
        const scrollY = Math.round(window.scrollY);
        const bodyLen = (document.body && document.body.innerText)
            ? document.body.innerText.length
            : 0;
        // Include first 200 chars of visible text to catch content changes
        const textSnippet = (document.body && document.body.innerText)
            ? document.body.innerText.slice(0, 200).replace(/\\s+/g, ' ')
            : '';
        return JSON.stringify({url, title, inputCount, buttonCount, linkCount, scrollY, bodyLen, textSnippet});
    } catch(e) {
        return JSON.stringify({error: e.toString()});
    }
})()
"""


class DOMChangeMonitor:
    """
    Tracks page state between agent steps.

    Usage in agent loop:
        monitor = DOMChangeMonitor()
        before_hash = await monitor.capture(browser)
        # ... execute tool ...
        changed = await monitor.has_changed(browser)
        if not changed:
            # inject reflection
    """

    def __init__(self, no_change_threshold: int = 2):
        """
        Args:
            no_change_threshold: Number of consecutive unchanged steps before
                                 forced reflection is triggered.
        """
        self._last_hash: Optional[str] = None
        self._last_fingerprint: Optional[dict] = None
        self._consecutive_no_change: int = 0
        self.no_change_threshold = no_change_threshold

    async def capture(self, browser) -> str:
        """
        Capture current page state and return its hash.
        Call this BEFORE executing a tool action.
        """
        fingerprint = await self._get_fingerprint(browser)
        h = self._hash(fingerprint)
        self._last_hash = h
        self._last_fingerprint = fingerprint
        return h

    async def has_changed(self, browser) -> bool:
        """
        Compare current page state to the last captured state.
        Call this AFTER executing a tool action.

        Returns:
            True  if the page state has visibly changed.
            False if the page appears identical to before the action.
        """
        fingerprint = await self._get_fingerprint(browser)
        current_hash = self._hash(fingerprint)

        if self._last_hash is None:
            # No prior capture — assume changed
            self._last_hash = current_hash
            self._last_fingerprint = fingerprint
            self._consecutive_no_change = 0
            return True

        changed = current_hash != self._last_hash

        if changed:
            self._consecutive_no_change = 0
            console.print(
                f"[dim green]DOM changed[/dim green] "
                f"({self._describe_change(self._last_fingerprint, fingerprint)})"
            )
        else:
            self._consecutive_no_change += 1
            console.print(
                f"[dim yellow]DOM unchanged[/dim yellow] "
                f"(streak: {self._consecutive_no_change})"
            )

        # Update stored state
        self._last_hash = current_hash
        self._last_fingerprint = fingerprint
        return changed

    def should_force_reflection(self) -> bool:
        """
        Returns True when the page has been unchanged for `no_change_threshold`
        consecutive steps, signalling the agent is stuck.
        """
        return self._consecutive_no_change >= self.no_change_threshold

    def reset_streak(self):
        """Reset the no-change streak counter (e.g. after a navigate action)."""
        self._consecutive_no_change = 0

    async def _get_fingerprint(self, browser) -> dict:
        """Extract a compact fingerprint dict from the live page."""
        try:
            import json
            raw = await browser.evaluate(_FINGERPRINT_SCRIPT)
            if isinstance(raw, str):
                return json.loads(raw)
            elif isinstance(raw, dict):
                return raw
            else:
                return {"raw": str(raw)}
        except Exception as e:
            return {"error": str(e), "url": getattr(browser.page, "url", "unknown")}

    @staticmethod
    def _hash(fingerprint: dict) -> str:
        """Deterministic hash of fingerprint dict."""
        canonical = str(sorted(fingerprint.items()))
        return hashlib.md5(canonical.encode()).hexdigest()

    @staticmethod
    def _describe_change(before: Optional[dict], after: dict) -> str:
        """Human-readable diff summary for console output."""
        if not before:
            return "initial state"
        parts = []
        if before.get("url") != after.get("url"):
            parts.append(f"URL: {after.get('url', '')[:60]}")
        if before.get("title") != after.get("title"):
            parts.append(f"title → '{after.get('title', '')[:40]}'")
        if before.get("bodyLen") != after.get("bodyLen"):
            delta = (after.get("bodyLen", 0) or 0) - (before.get("bodyLen", 0) or 0)
            parts.append(f"content Δ{delta:+d} chars")
        if before.get("inputCount") != after.get("inputCount"):
            parts.append(f"inputs: {before.get('inputCount')}→{after.get('inputCount')}")
        return ", ".join(parts) if parts else "subtle change"
