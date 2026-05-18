"""
Agentic Browser V2 - Enhanced with Vision, Memory, Multi-Tab, and Auto-Retry
Full-featured version integrating all advanced capabilities
"""
import asyncio
import json
import base64
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from datetime import datetime
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.layout import Layout

from browser import AgenticBrowser
from tools import ToolRegistry
from vision import VisionAnalyzer, VisionEnabledAgentMixin
from memory import MemoryManager
from tab_manager import TabManager, ParallelSearchManager
from retry_handler import RetryHandler, with_retry, RecoveryContext
from dom_monitor import DOMChangeMonitor
from planner import TaskPlanner
from state_checkpoint import StateCheckpointer

console = Console()


@dataclass
class AgentStep:
    """Enhanced step with all metadata"""
    step_num: int
    timestamp: datetime
    thought: str
    action: str
    action_input: Dict[str, Any]
    observation: Optional[str] = None
    screenshot: Optional[str] = None
    vision_analysis: Optional[Dict[str, Any]] = None
    tab_id: Optional[str] = None
    retry_count: int = 0
    error: Optional[str] = None


class LLMClient:
    """Enhanced LLM client with vision support"""
    
    def __init__(self, provider: str = "openai", api_key: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        import httpx
        self.client = httpx.AsyncClient(timeout=120.0)
    
    async def call(
        self,
        messages: List[Dict],
        tools: Optional[List[Dict]] = None,
        include_vision: bool = False,
        screenshot_b64: Optional[str] = None
    ) -> Dict:
        """Call LLM with optional vision input"""
        
        # Add screenshot to last message if vision enabled
        if include_vision and screenshot_b64 and messages:
            last_msg = messages[-1]
            if isinstance(last_msg.get("content"), str):
                # Convert to multimodal format
                content = [
                    {"type": "text", "text": last_msg["content"]},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{screenshot_b64}",
                            "detail": "high"
                        }
                    }
                ]
                messages[-1]["content"] = content
        
        if self.provider == "openai":
            return await self._call_openai(messages, tools)
        elif self.provider == "anthropic":
            return await self._call_anthropic(messages, tools)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")
    
    async def _call_openai(self, messages: List[Dict], tools: Optional[List[Dict]]) -> Dict:
        """Call OpenAI API"""
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "max_tokens": 4096,
            "temperature": 0.7
        }
        
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        
        response = await self.client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]
    
    async def _call_anthropic(self, messages: List[Dict], tools: Optional[List[Dict]]) -> Dict:
        """Call Anthropic API"""
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }
        
        # Convert format
        system_msg = ""
        anthropic_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg.get("content", "")
            else:
                content = msg.get("content", "")
                # Handle multimodal content
                if isinstance(content, list):
                    anthropic_content = content
                else:
                    anthropic_content = [{"type": "text", "text": content}]
                
                anthropic_messages.append({
                    "role": msg.get("role"),
                    "content": anthropic_content
                })
        
        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": 4096,
            "messages": anthropic_messages,
            "temperature": 0.7
        }
        
        if system_msg:
            payload["system"] = system_msg
        
        if tools:
            # Convert OpenAI tool format to Anthropic
            payload["tools"] = [{"name": t["function"]["name"], **t["function"]} for t in tools]
        
        response = await self.client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        
        # Format response
        content = result["content"][0]["text"] if result["content"] else ""
        return {"content": content, "role": "assistant"}


class AgenticAgentV2:
    """
    Fully-featured agentic browser with:
    - Vision capabilities (screenshot analysis)
    - Persistent memory across sessions
    - Multi-tab management
    - Automatic retry and recovery
    """
    
    def __init__(
        self,
        task: str,
        llm_provider: str = "openai",
        llm_api_key: Optional[str] = None,
        headless: bool = False,
        use_vision: bool = True,
        use_memory: bool = True,
        enable_multi_tab: bool = True,
        max_steps: int = 25,
        viewport: Dict = None
    ):
        self.task = task
        self.llm = LLMClient(llm_provider, llm_api_key)
        self.browser = AgenticBrowser(headless=headless, viewport=viewport)
        self.tools = ToolRegistry()
        self.retry_handler = RetryHandler()
        
        # Optional features
        self.use_vision = use_vision
        self.vision_analyzer = VisionAnalyzer(llm_provider, llm_api_key) if use_vision else None
        
        self.use_memory = use_memory
        self.memory = MemoryManager() if use_memory else None
        
        self.enable_multi_tab = enable_multi_tab
        self.tab_manager: Optional[TabManager] = None
        self.parallel_search: Optional[ParallelSearchManager] = None
        
        self.max_steps = max_steps
        self.history: List[AgentStep] = []
        self.start_time: Optional[datetime] = None
        self.stats = {
            "steps": 0,
            "retries": 0,
            "errors": 0,
            "screenshots_taken": 0,
            "reflections_triggered": 0,
        }
        # DOM change monitor — detects stale/no-effect actions
        self.dom_monitor = DOMChangeMonitor(no_change_threshold=2)
        # Track last DOM hash seen by vision to debounce identical-page calls
        self._last_vision_dom_hash: Optional[str] = None
        self._last_vision_analysis: Optional[Dict[str, Any]] = None
        # Sliding-window context compression settings
        self._max_message_window = 10  # messages kept in full
        self._summarised_context: str = ""   # rolling summary of older steps
        # Hierarchical planner
        self.planner = TaskPlanner(llm_provider, llm_api_key)
        # Register milestone completion tool dynamically
        self.tools.register(
            name="complete_milestone",
            description="Mark the current plan milestone as complete and advance to the next one. Use this when you have successfully finished the current high-level goal.",
            parameters={"type": "object", "properties": {}, "required": []},
            function=self._complete_milestone_tool
        )
        # State checkpointer (save every 5 steps)
        self.checkpointer = StateCheckpointer()
        self._checkpoint_interval = 5
        
    async def _complete_milestone_tool(self, browser, **kwargs) -> str:
        """Tool implementation to advance the planner milestone."""
        return self.planner.complete_milestone()
    async def run(self) -> str:
        """Execute task with all enhancements"""
        console.print(Panel(
            f"[bold blue]🌐 Agentic Browser V2[/bold blue]\n"
            f"[dim]Task: {self.task}[/dim]\n"
            f"[dim]Features: Vision={self.use_vision} | Memory={self.use_memory} | Multi-Tab={self.enable_multi_tab}[/dim]",
            border_style="blue"
        ))
        
        self.start_time = datetime.now()
        
        # Initialize memory
        if self.memory:
            self.memory.start_session(self.task)
            similar_tasks = await self.memory.get_similar_tasks(self.task)
            if similar_tasks:
                console.print(f"[dim]Found {len(similar_tasks)} similar previous tasks[/dim]")

        # Run hierarchical planner before execution
        await self.planner.decompose(self.task, max_steps=self.max_steps)
        
        # Initialize browser
        start_result = await self.retry_handler.execute_with_retry(
            self.browser.start,
            context={"browser": self.browser}
        )
        console.print("[green]✓[/green] Browser started")
        
        # Initialize tab manager
        if self.enable_multi_tab:
            self.tab_manager = TabManager(self.browser, max_tabs=8)
            self.parallel_search = ParallelSearchManager(self.tab_manager)
            # Create initial tab
            await self.tab_manager.create_tab(activate=True)
            console.print("[green]✓[/green] Multi-tab manager ready")
        
        try:
            result = await self._run_loop()
            
            # Save session
            if self.memory:
                await self.memory.end_session(
                    success=True,
                    result=result
                )
            
            return result
            
        except Exception as e:
            console.print(f"[red]✗ Task failed: {e}[/red]")
            
            if self.memory:
                await self.memory.end_session(
                    success=False,
                    result=f"Failed: {str(e)}"
                )
            
            raise
            
        finally:
            # Cleanup
            if self.tab_manager:
                await self.tab_manager.close_all()
            await self.browser.close()
            
            # Print stats
            duration = datetime.now() - self.start_time
            console.print(f"\n[dim]Completed in {duration.total_seconds():.1f}s | "
                         f"Steps: {self.stats['steps']} | "
                         f"Retries: {self.stats['retries']} | "
                         f"Errors: {self.stats['errors']}[/dim]")
    
    async def _run_loop(self) -> str:
        """Main agent loop with all features"""

        system_prompt = self._build_system_prompt()
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"Task: {self.task}\n\nStart by navigating to the appropriate website and complete the task step by step."
            }
        ]

        for step_num in range(self.max_steps):
            self.stats["steps"] += 1

            # ── Context window compression ─────────────────────────────────────
            messages = self._compress_messages(messages, system_prompt)

            # ── Get current state ──────────────────────────────────────────────
            if self.tab_manager:
                active_tab = self.tab_manager.get_active_tab()
                if active_tab:
                    await self.tab_manager.refresh_tab(active_tab.id)
                    url, title = active_tab.url, active_tab.title
                    content = active_tab.context
                    self.browser.page = active_tab.page
                else:
                    url, title, content = await self.browser.get_page_info()
            else:
                url, title, content = await self.browser.get_page_info()

            # ── Visual Element Mapping (Skyvern Method) ───────────────────────
            element_map = await self.browser.tag_interactive_elements()
            element_map_str = ""
            if element_map:
                element_map_str = "\nInteractive Elements (Use element_id parameter):\n"
                # Show up to 75 elements to keep context reasonable
                for el_id, el_info in list(element_map.items())[:75]:
                    text = el_info.get('text', '')
                    if text:
                        element_map_str += f"  [{el_id}]: {el_info['type']} '{text}'\n"
                    else:
                        element_map_str += f"  [{el_id}]: {el_info['type']}\n"

            # ── Screenshot ────────────────────────────────────────────────────
            # Screenshot now contains the red numbered visual tags
            screenshot_b64 = await self.browser.screenshot()
            self.stats["screenshots_taken"] += 1

            # ── Vision analysis (debounced — skipped when DOM is unchanged) ────────────
            vision_analysis = None
            vision_context = ""
            if self.use_vision and self.vision_analyzer:
                current_dom_hash = self.dom_monitor._last_hash
                dom_changed_since_vision = (current_dom_hash != self._last_vision_dom_hash)
                if dom_changed_since_vision:
                    try:
                        previous_actions = [f"{s.action}: {s.action_input}" for s in self.history[-3:]]
                        vision_analysis = await self.vision_analyzer.analyze_screenshot(
                            screenshot_b64, self.task, previous_actions
                        )
                        vision_context = self._format_vision_context(vision_analysis)
                        self._last_vision_dom_hash = current_dom_hash
                        self._last_vision_analysis = vision_analysis
                    except Exception as e:
                        console.print(f"[dim]Vision analysis failed: {e}[/dim]")
                else:
                    # Reuse cached analysis to avoid redundant API cost
                    vision_analysis = self._last_vision_analysis
                    if vision_analysis:
                        vision_context = self._format_vision_context(vision_analysis)
                        console.print("[dim]Vision: reusing cached analysis (DOM unchanged)[/dim]")


            # ── Capture DOM state BEFORE action ───────────────────────────────
            await self.dom_monitor.capture(self.browser)

            # ── Build step context ────────────────────────────────────────────
            # Inject current milestone from the planner
            milestone_ctx = self.planner.get_milestone_context()

            state_info = f"""
--- Step {step_num + 1}/{self.max_steps} ---
URL: {url}
Title: {title}
Content Preview: {content[:1000]}...{element_map_str}
{vision_context}{milestone_ctx}
"""
            if step_num == 0:
                messages[1]["content"] += state_info
            else:
                messages.append({"role": "user", "content": state_info})

            # ── LLM call ──────────────────────────────────────────────────────
            try:
                response = await self.retry_handler.execute_with_retry(
                    self.llm.call,
                    messages=messages,
                    tools=self.tools.get_tool_schemas(),
                    include_vision=self.use_vision,
                    screenshot_b64=screenshot_b64 if self.use_vision else None,
                    context={"browser": self.browser}
                )
            except Exception as e:
                console.print(f"[red]LLM call failed: {e}[/red]")
                self.stats["errors"] += 1
                continue

            # ── Parse response ────────────────────────────────────────────────
            thought, action, action_input = self._parse_response(response)

            console.print(f"\n[bold cyan]Step {step_num + 1}[/bold cyan]")
            console.print(f"[yellow]Thought:[/yellow] {thought[:150]}...")
            console.print(f"[green]Action:[/green] [bold]{action}[/bold]")

            if action_input:
                action_str = json.dumps(action_input, indent=None)[:100]
                console.print(f"[dim]Input: {action_str}[/dim]")

            # ── Execute action ────────────────────────────────────────────────
            observation = None
            error = None
            retry_count = 0

            async def execute_tool():
                return await self.tools.execute(action, action_input, self.browser)

            try:
                observation = await self.retry_handler.execute_with_retry(
                    execute_tool,
                    context={"browser": self.browser},
                    on_retry=lambda attempt, err, err_type: self._on_retry(attempt, err, err_type)
                )
                retry_count = 0
            except Exception as e:
                error = str(e)
                observation = f"Error: {error}"
                self.stats["errors"] += 1

            if observation:
                console.print(f"[dim blue]Observation:[/dim blue] {str(observation)[:120]}...")

            # ── DOM change detection ──────────────────────────────────────────
            action_changed_dom = True
            if action not in ("think", "terminate", "wait", "screenshot"):
                try:
                    action_changed_dom = await self.dom_monitor.has_changed(self.browser)
                except Exception:
                    pass  # Monitor errors are non-fatal

            # ── Reflexive error injection ─────────────────────────────────────
            reflection_needed = (
                (observation and str(observation).startswith("Error:")) or
                (observation and "failed after all fallbacks" in str(observation)) or
                (not action_changed_dom and self.dom_monitor.should_force_reflection())
            )

            if reflection_needed:
                self.stats["reflections_triggered"] += 1
                console.print("[bold yellow]⚡ Reflection triggered — forcing alternative approach[/bold yellow]")
                reflection_msg = (
                    f"⚠ The last action ('{action}') had no effect or failed.\n"
                    f"Observation: {str(observation)[:300]}\n\n"
                    f"MANDATORY: Do NOT retry the exact same action. Instead, try ONE of:\n"
                    f"  • Use 'evaluate_script' to interact via JavaScript directly\n"
                    f"  • Use 'get_dom' to inspect the HTML and find a better selector\n"
                    f"  • Use 'wait_for_element' if the page may still be loading\n"
                    f"  • Click a parent or sibling element\n"
                    f"  • Use 'hover' first to reveal hidden menus\n"
                    f"  • Try 'scroll' to bring the element into view\n"
                    f"  • Reconsider whether the task requires a different approach entirely"
                )
                messages.append({"role": "user", "content": reflection_msg})

            # ── Record step ───────────────────────────────────────────────────
            step = AgentStep(
                step_num=step_num + 1,
                timestamp=datetime.now(),
                thought=thought,
                action=action,
                action_input=action_input,
                observation=str(observation)[:500] if observation else None,
                screenshot=screenshot_b64,
                vision_analysis=vision_analysis,
                tab_id=self.tab_manager.get_active_tab().id if self.tab_manager else None,
                retry_count=retry_count,
                error=error
            )
            self.history.append(step)

            # ── Save to memory ────────────────────────────────────────────────
            if self.memory:
                await self.memory.record_step(
                    action=action,
                    action_input=action_input,
                    observation=str(observation)[:500] if observation else "",
                    screenshot_b64=screenshot_b64
                )
                if url:
                    await self.memory.record_url(url)

            # ── Update message history ────────────────────────────────────────
            # Only append if we didn't already inject a reflection (avoids duplication)
            if not reflection_needed:
                messages.append({
                    "role": "assistant",
                    "content": f"Thought: {thought}\nAction: {action}"
                })
                messages.append({
                    "role": "user",
                    "content": f"Observation: {observation}"
                })
            else:
                # Include assistant turn before the reflection
                messages.insert(-1, {
                    "role": "assistant",
                    "content": f"Thought: {thought}\nAction: {action}"
                })
                messages.insert(-1, {
                    "role": "user",
                    "content": f"Observation: {observation}"
                })

            # ── Checkpoint every N steps ──────────────────────────────────────
            if (step_num + 1) % self._checkpoint_interval == 0 and action != "terminate":
                await self.checkpointer.save(
                    self.browser,
                    step_num=step_num + 1,
                    note=f"Step {step_num + 1}: last action was '{action}'"
                )

            # ── Reset DOM stale streak on navigate ────────────────────────────
            if action == "navigate":
                self.dom_monitor.reset_streak()

            # ── Check completion ──────────────────────────────────────────────
            if action == "terminate" or step_num == self.max_steps - 1:
                answer = action_input.get("answer", "Task completed")
                console.print(f"\n[bold green]✓ {answer}[/bold green]")
                return answer

        return f"Task completed after {self.max_steps} steps"
    
    def _build_system_prompt(self) -> str:
        """Build enhanced system prompt with memory context"""
        base_prompt = f"""You are an intelligent web automation agent with access to a Chromium browser.

Available Tools:
{self.tools.get_tool_descriptions()}

Instructions:
1. Think step by step about what needs to be done
2. Use tools to interact with the browser
3. Take screenshots to verify visual state (vision enabled)
4. Use multiple tabs for parallel tasks when efficient
5. Retry failed actions with different approaches
6. Terminate with success status when task is complete

When navigating:
- Use full URLs (https://example.com)
- Wait for page to load; use wait_for_element if content takes time

When clicking:
- Prefer 'text' parameter over raw CSS selectors for reliability
- If click fails, use get_dom to find the correct selector, then try again
- Use evaluate_script as a last resort: document.querySelector('...').click()

When typing:
- Clear fields before typing unless appending
- Wait for form validation if present

When stuck (no page change after an action):
- You will receive a MANDATORY reflection prompt
- Switch approach immediately: try evaluate_script, get_dom, hover, or scroll
- Do NOT repeat the same failed action more than once

Task Completion:
- Call 'terminate' with the final answer
- Include all requested information in the answer
"""

        # Add memory context if available
        if self.memory and self.memory.current_session:
            similar = asyncio.run(self.memory.get_similar_tasks(self.task))
            if similar:
                base_prompt += f"\n\nSimilar completed tasks: {len(similar)}"

        return base_prompt

    def _compress_messages(
        self,
        messages: List[Dict],
        system_prompt: str
    ) -> List[Dict]:
        """
        Sliding-window context compression.

        Keeps the system message + first user message (task) intact.
        Condenses all messages older than _max_message_window into a
        single summary block inserted after the initial user message.
        This prevents token bloat on long tasks.
        """
        # system + initial task = 2 messages always kept
        fixed_head = 2
        if len(messages) <= fixed_head + self._max_message_window:
            return messages  # Nothing to compress yet

        # Messages to archive (oldest non-fixed)
        overflow = messages[fixed_head: len(messages) - self._max_message_window]
        tail = messages[len(messages) - self._max_message_window:]

        # Build a compact summary of the overflow messages
        summary_lines = []
        for msg in overflow:
            role = msg.get("role", "?")
            content = msg.get("content", "")
            if isinstance(content, list):  # multimodal
                content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
            snippet = str(content)[:200].replace("\n", " ")
            summary_lines.append(f"[{role}] {snippet}")

        # Append to rolling summary
        new_summary = "\n".join(summary_lines)
        if self._summarised_context:
            self._summarised_context += "\n" + new_summary
        else:
            self._summarised_context = new_summary

        # Cap summary size
        if len(self._summarised_context) > 3000:
            self._summarised_context = "...(earlier steps omitted)...\n" + self._summarised_context[-2500:]

        summary_msg = {
            "role": "user",
            "content": (
                f"[HISTORY SUMMARY — {len(overflow)} earlier steps]\n"
                f"{self._summarised_context}\n"
                "[END SUMMARY — continue from current state below]"
            )
        }

        compressed = [messages[0], messages[1], summary_msg] + tail
        console.print(
            f"[dim]Context compressed: {len(messages)} → {len(compressed)} messages[/dim]"
        )
        return compressed
    
    def _format_vision_context(self, vision_analysis: Dict) -> str:
        """Format vision analysis as context string"""
        if not vision_analysis:
            return ""
        
        context = f"""
Visual Analysis:
- State: {vision_analysis.get('page_state', 'unknown')}
- Progress: {vision_analysis.get('task_progress', 'unknown')}
- Suggestion: {vision_analysis.get('suggested_action', 'N/A')}"""
        
        elements = vision_analysis.get('ui_elements', [])
        if elements:
            context += "\n- Key Elements: " + ", ".join(
                e.get('text', e.get('type', 'element'))
                for e in elements[:3]
            )
        
        return context
    
    def _parse_response(self, response: Dict) -> tuple:
        """Parse LLM response"""
        content = response.get("content", "")
        
        # Check for tool calls
        if "tool_calls" in response:
            tool_call = response["tool_calls"][0]
            action = tool_call["function"]["name"]
            try:
                action_input = json.loads(tool_call["function"]["arguments"])
            except:
                action_input = {}
            thought = f"Using tool: {action}"
            return thought, action, action_input
        
        # Parse text response
        thought = ""
        action = "think"
        action_input = {"thought": content}
        
        import re
        
        # Extract action patterns
        if "navigate" in content.lower() and "http" in content:
            action = "navigate"
            urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', content)
            if urls:
                action_input = {"url": urls[0]}
        
        elif re.search(r'click.*on\s+(.+?)(?:\.|$)', content, re.IGNORECASE):
            match = re.search(r'click.*on\s+(.+?)(?:\.|$)', content, re.IGNORECASE)
            action = "click"
            # Use the full captured phrase (e.g. "the Submit button") not just first word
            action_input = {"text": match.group(1).strip()}
        
        elif re.search(r'type\s+["\'](.+)["\']\s+into', content, re.IGNORECASE):
            match = re.search(r'type\s+["\'](.+)["\']\s+into\s+(\w+)', content, re.IGNORECASE)
            action = "type"
            action_input = {
                "selector": f"input[placeholder*='{match.group(2)}']" if len(match.groups()) > 1 else "input",
                "text": match.group(1)
            }
        
        elif "done" in content.lower() or "complete" in content.lower() or "finish" in content.lower():
            action = "terminate"
            # Extract answer after "answer is" or similar
            answer = content
            if "answer is" in content.lower():
                answer = content.split("answer is", 1)[1].strip()
            action_input = {"answer": answer[:500]}
        
        return thought, action, action_input
    
    def _on_retry(self, attempt: int, error: Exception, error_type):
        """Callback when retry occurs"""
        self.stats["retries"] = getattr(self, 'retry_count', 0) + 1
        console.print(f"[dim]→ Retry {attempt + 1} ({error_type.value})[/dim]")
    
    # Multi-tab operations
    
    async def parallel_search(
        self,
        query: str,
        sites: List[str]
    ) -> List[Dict]:
        """Execute parallel search across multiple sites"""
        if not self.parallel_search:
            raise RuntimeError("Multi-tab not enabled")
        
        console.print(f"[blue]Starting parallel search across {len(sites)} sites...[/blue]")
        
        results = await self.parallel_search.search_multiple(query, sites)
        
        console.print(f"[green]✓[/green] Parallel search complete ({len(results)} results)")
        return results
    
    async def open_new_tab(self, url: Optional[str] = None) -> str:
        """Open and activate a new tab"""
        if not self.tab_manager:
            raise RuntimeError("Multi-tab not enabled")
        
        tab = await self.tab_manager.create_tab(url=url, activate=True)
        return tab.id
    
    async def switch_tab(self, tab_id: str):
        """Switch to a different tab"""
        if not self.tab_manager:
            raise RuntimeError("Multi-tab not enabled")
        
        success = await self.tab_manager.switch_to_tab(tab_id)
        if success:
            console.print(f"[dim]Switched to tab {tab_id}[/dim]")
        return success
    
    def get_session_report(self) -> str:
        """Generate detailed session report"""
        if self.memory:
            import asyncio
            return asyncio.run(self.memory.export_session_report())
        return "Memory not enabled"


# Backwards compatibility alias
AgenticAgent = AgenticAgentV2
