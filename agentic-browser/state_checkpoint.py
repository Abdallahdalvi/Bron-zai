"""
State Checkpointing - Browser state snapshot and rollback.

Saves and restores:
  - Cookies (via Playwright context.cookies())
  - localStorage (via page.evaluate)
  - sessionStorage (via page.evaluate)
  - Current URL

Checkpoints are taken every N steps and stored in memory_dir/checkpoints/.
On fatal failure the agent can roll back to the last good checkpoint rather
than restarting the entire task from scratch.
"""
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
from rich.console import Console

console = Console()


@dataclass
class Checkpoint:
    """A full browser state snapshot."""
    id: str
    step_num: int
    timestamp: str
    url: str
    title: str
    cookies: List[Dict[str, Any]] = field(default_factory=list)
    local_storage: Dict[str, str] = field(default_factory=dict)
    session_storage: Dict[str, str] = field(default_factory=dict)
    task_progress_note: str = ""  # Human-readable note on progress at this point


_STORAGE_EXTRACT_SCRIPT = """
(function() {
    var ls = {};
    var ss = {};
    try {
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            ls[k] = localStorage.getItem(k);
        }
    } catch(e) {}
    try {
        for (var i = 0; i < sessionStorage.length; i++) {
            var k = sessionStorage.key(i);
            ss[k] = sessionStorage.getItem(k);
        }
    } catch(e) {}
    return {localStorage: ls, sessionStorage: ss};
})()
"""

_STORAGE_RESTORE_SCRIPT = """
(function(ls, ss) {
    try {
        localStorage.clear();
        for (var k in ls) { localStorage.setItem(k, ls[k]); }
    } catch(e) {}
    try {
        sessionStorage.clear();
        for (var k in ss) { sessionStorage.setItem(k, ss[k]); }
    } catch(e) {}
})({local}, {session})
"""


class StateCheckpointer:
    """
    Manages browser state checkpoints for rollback capability.

    Usage in agent loop:
        checkpointer = StateCheckpointer()
        await checkpointer.save(browser, step_num=5, note="Logged in successfully")
        # ... if later steps fail ...
        await checkpointer.restore(browser, checkpoint_id)
    """

    def __init__(self, checkpoint_dir: str = "agent_memory/checkpoints", max_checkpoints: int = 5):
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.max_checkpoints = max_checkpoints
        self._checkpoints: List[Checkpoint] = []

    async def save(
        self,
        browser,
        step_num: int,
        note: str = ""
    ) -> Optional[Checkpoint]:
        """
        Save current browser state as a checkpoint.

        Args:
            browser:   AgenticBrowser instance
            step_num:  Current step number (used in checkpoint ID)
            note:      Human-readable description of task progress at this point

        Returns:
            The created Checkpoint, or None if saving failed.
        """
        try:
            url = browser.page.url if browser.page else ""
            title = await browser.page.title() if browser.page else ""

            # Cookies
            cookies = await browser.context.cookies() if browser.context else []

            # localStorage + sessionStorage
            storage = await browser.evaluate(_STORAGE_EXTRACT_SCRIPT)
            local_storage = storage.get("localStorage", {}) if isinstance(storage, dict) else {}
            session_storage = storage.get("sessionStorage", {}) if isinstance(storage, dict) else {}

            cp = Checkpoint(
                id=f"cp_{step_num:03d}_{datetime.now().strftime('%H%M%S')}",
                step_num=step_num,
                timestamp=datetime.now().isoformat(),
                url=url,
                title=title,
                cookies=cookies,
                local_storage=local_storage,
                session_storage=session_storage,
                task_progress_note=note,
            )

            # Persist to disk
            filepath = self.checkpoint_dir / f"{cp.id}.json"
            filepath.write_text(json.dumps(asdict(cp), indent=2, default=str))

            self._checkpoints.append(cp)
            console.print(f"[dim green]💾 Checkpoint saved: {cp.id} @ step {step_num}[/dim green]")

            # Prune old checkpoints beyond max
            await self._prune_old_checkpoints()

            return cp

        except Exception as e:
            console.print(f"[dim yellow]Checkpoint save failed: {e}[/dim yellow]")
            return None

    async def restore(self, browser, checkpoint_id: Optional[str] = None) -> bool:
        """
        Restore browser state from a checkpoint.

        Args:
            browser:        AgenticBrowser instance
            checkpoint_id:  ID of checkpoint to restore (None = use latest)

        Returns:
            True if restoration succeeded, False otherwise.
        """
        cp = self._find_checkpoint(checkpoint_id)
        if not cp:
            console.print("[red]No checkpoint found to restore[/red]")
            return False

        try:
            console.print(f"[yellow]⏪ Restoring checkpoint {cp.id} (step {cp.step_num}: {cp.url})[/yellow]")

            # ── Step 1: Restore cookies BEFORE navigating so auth state is intact
            if cp.cookies and browser.context:
                await browser.context.clear_cookies()
                await browser.context.add_cookies(cp.cookies)

            # ── Step 2: Navigate to the saved URL (cookies already present)
            if cp.url:
                await browser.navigate(cp.url)
                await asyncio.sleep(1.5)  # Allow page to settle

            # ── Step 3: Restore localStorage / sessionStorage after page load
            if cp.local_storage or cp.session_storage:
                restore_script = _STORAGE_RESTORE_SCRIPT.format(
                    local=json.dumps(cp.local_storage),
                    session=json.dumps(cp.session_storage),
                )
                await browser.evaluate(restore_script)
            # No extra reload needed — storage is injected into the already-loaded page

            console.print(f"[green]✓ Restored to: {cp.url}[/green]")
            return True

        except Exception as e:
            console.print(f"[red]Checkpoint restore failed: {e}[/red]")
            return False

    def get_latest(self) -> Optional[Checkpoint]:
        """Return the most recent checkpoint."""
        if self._checkpoints:
            return self._checkpoints[-1]
        return None

    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """Return summary list of all stored checkpoints."""
        return [
            {
                "id": cp.id,
                "step": cp.step_num,
                "url": cp.url[:60],
                "note": cp.task_progress_note[:80],
                "timestamp": cp.timestamp,
            }
            for cp in self._checkpoints
        ]

    def _find_checkpoint(self, checkpoint_id: Optional[str]) -> Optional[Checkpoint]:
        """Find a checkpoint by ID, or return the latest if ID is None."""
        if checkpoint_id is None:
            return self.get_latest()
        for cp in reversed(self._checkpoints):
            if cp.id == checkpoint_id:
                return cp
        # Try loading from disk
        filepath = self.checkpoint_dir / f"{checkpoint_id}.json"
        if filepath.exists():
            data = json.loads(filepath.read_text())
            return Checkpoint(**data)
        return None

    async def _prune_old_checkpoints(self):
        """Remove oldest checkpoints beyond max_checkpoints."""
        while len(self._checkpoints) > self.max_checkpoints:
            old = self._checkpoints.pop(0)
            old_file = self.checkpoint_dir / f"{old.id}.json"
            if old_file.exists():
                old_file.unlink()
            console.print(f"[dim]Pruned old checkpoint: {old.id}[/dim]")
