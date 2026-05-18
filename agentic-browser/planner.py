"""
Task Planner - Hierarchical planning for the agentic browser.

Splits the AI reasoning into two layers:
  1. PLANNER: Makes a single LLM call upfront to decompose the task into
              ordered milestones (high-level sub-goals).
  2. EXECUTOR: The existing agent loop, but now guided by the current milestone
               so it never loses sight of the overall goal.

This prevents the greedy, step-by-step blindness documented in the review:
the executor always knows *where it is* in the overall plan.
"""
import json
from typing import List, Optional
import httpx
from rich.console import Console

console = Console()


class TaskPlanner:
    """
    Decomposes a complex task into ordered milestones before execution.

    Usage:
        planner = TaskPlanner(provider, api_key)
        milestones = await planner.decompose("Book a flight from NYC to LA next Friday")
        # => ["1. Navigate to a flight booking site",
        #     "2. Enter departure NYC and destination LA",
        #     "3. Set date to next Friday",
        #     "4. Select cheapest available option",
        #     "5. Confirm booking details"]

        milestone = planner.get_current_milestone(step_num=3)
        # => "3. Set date to next Friday"
    """

    def __init__(self, provider: str = "openai", api_key: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        self.milestones: List[str] = []
        self._current_milestone_idx = 0
        self.client = httpx.AsyncClient(timeout=60.0)

    async def decompose(self, task: str, max_steps: int = 25) -> List[str]:
        """
        Call the LLM once to produce an ordered list of milestones.

        Returns the milestone list. Falls back to a single-item list
        (the task itself) if the LLM call fails, so the executor is
        never blocked.
        """
        try:
            milestones = await self._call_llm(task, max_steps)
            self.milestones = milestones
            console.print(
                f"[bold blue]📋 Plan ({len(milestones)} milestones):[/bold blue]"
            )
            for i, m in enumerate(milestones, 1):
                console.print(f"  [dim]{i}. {m}[/dim]")
            return milestones
        except Exception as e:
            console.print(f"[yellow]Planner failed ({e}), running without milestones[/yellow]")
            self.milestones = [task]
            return self.milestones

    def get_current_milestone(self) -> str:
        """
        Return the currently active milestone.
        """
        if not self.milestones or self._current_milestone_idx >= len(self.milestones):
            return ""
        return self.milestones[self._current_milestone_idx]

    def complete_milestone(self) -> str:
        """
        Mark the current milestone as complete and advance to the next one.
        Returns a status message.
        """
        if not self.milestones:
            return "No plan available."
        
        if self._current_milestone_idx < len(self.milestones) - 1:
            prev = self.milestones[self._current_milestone_idx]
            self._current_milestone_idx += 1
            next_m = self.milestones[self._current_milestone_idx]
            return f"Completed: '{prev}'. Advanced to next milestone: '{next_m}'"
        elif self._current_milestone_idx == len(self.milestones) - 1:
            prev = self.milestones[self._current_milestone_idx]
            self._current_milestone_idx += 1
            return f"Completed final milestone: '{prev}'. All milestones finished!"
        return "All milestones are already complete."

    def get_milestone_context(self) -> str:
        """Return a formatted context string for injection into the step prompt."""
        if not self.milestones:
            return ""

        idx = self._current_milestone_idx
        lines = ["\n🗺 PLAN PROGRESS:"]
        for i, m in enumerate(self.milestones):
            if i < idx:
                lines.append(f"  ✅ {m}")
            elif i == idx:
                lines.append(f"  ▶ {m}  ← CURRENT MILESTONE")
            else:
                lines.append(f"  ○ {m}")
        return "\n".join(lines) + "\n"

    async def _call_llm(self, task: str, max_steps: int) -> List[str]:
        """Internal LLM call to produce milestones."""
        system_content = (
            "You are a task planning assistant for a web automation agent. "
            "Your job is to decompose a complex browser task into a concise, "
            "ordered list of high-level milestones. Each milestone should be "
            "a single actionable sub-goal. Output ONLY a JSON array of strings, "
            f"with between 3 and {min(max_steps // 3, 8)} items. "
            "No markdown, no explanation — just the JSON array."
        )
        user_content = f"Task: {task}"

        if self.provider == "openai":
            return await self._call_openai(system_content, user_content)
        elif self.provider == "anthropic":
            return await self._call_anthropic(system_content, user_content)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")

    async def _call_openai(self, system_content: str, user_content: str) -> List[str]:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": 512,
            "temperature": 0.2,
        }
        resp = await self.client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        return self._parse_milestone_json(raw)

    async def _call_anthropic(self, system_content: str, user_content: str) -> List[str]:
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": 512,
            "system": system_content,
            "messages": [{"role": "user", "content": user_content}],
        }
        resp = await self.client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        raw = resp.json()["content"][0]["text"].strip()
        return self._parse_milestone_json(raw)

    @staticmethod
    def _parse_milestone_json(raw: str) -> List[str]:
        """Extract a JSON array from the LLM response."""
        # Strip markdown fences if present
        if "```" in raw:
            raw = raw.split("```")[1] if "```json" not in raw else raw.split("```json")[1].split("```")[0]

        data = json.loads(raw.strip())
        if isinstance(data, list):
            return [str(item) for item in data if item]
        raise ValueError(f"Expected a JSON array, got: {type(data)}")
