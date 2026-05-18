"""
Agentic Browser - Core Agent Loop
Based on BrowserOS/Browser-Use architecture
"""
import asyncio
import json
import base64
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
import httpx

from browser import AgenticBrowser
from tools import ToolRegistry

console = Console()


@dataclass
class AgentStep:
    """Single step taken by the agent"""
    thought: str
    action: str
    action_input: Dict[str, Any]
    observation: Optional[str] = None
    screenshot: Optional[str] = None


class LLMClient:
    """LLM client supporting multiple providers"""
    
    def __init__(self, provider: str = "openai", api_key: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        self.client = httpx.AsyncClient(timeout=120.0)
    
    async def call(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict:
        """Call LLM with messages and tools"""
        
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
        
        # Convert OpenAI format to Anthropic format
        system_msg = ""
        anthropic_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg.get("content", "")
            else:
                anthropic_messages.append({
                    "role": msg.get("role"),
                    "content": [{"type": "text", "text": msg.get("content", "")}]
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
            payload["tools"] = tools
        
        response = await self.client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        
        # Convert back to OpenAI format
        content = result["content"][0]["text"] if result["content"] else ""
        return {"content": content, "role": "assistant"}


class AgenticAgent:
    """
    Main agent class that orchestrates browser automation
    """
    
    def __init__(
        self,
        task: str,
        llm_provider: str = "openai",
        llm_api_key: Optional[str] = None,
        headless: bool = False
    ):
        self.task = task
        self.llm = LLMClient(llm_provider, llm_api_key)
        self.browser = AgenticBrowser(headless=headless)
        self.tools = ToolRegistry()
        self.history: List[AgentStep] = []
        self.max_steps = 20
        
    async def run(self) -> str:
        """Execute the task"""
        console.print(Panel(f"[bold blue]Task: {self.task}[/bold blue]", border_style="blue"))
        
        # Initialize browser
        await self.browser.start()
        console.print("[green]✓[/green] Browser started")
        
        try:
            result = await self._run_loop()
            return result
        finally:
            await self.browser.close()
            console.print("[green]✓[/green] Browser closed")
    
    async def _run_loop(self) -> str:
        """Main agent loop"""
        
        # Build system prompt
        system_prompt = self._build_system_prompt()
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Task: {self.task}\n\nStart by navigating to the appropriate website and complete the task step by step."}
        ]
        
        for step_num in range(self.max_steps):
            console.print(f"\n[bold cyan]Step {step_num + 1}/{self.max_steps}[/bold cyan]")
            
            # Get current page state
            url, title, content = await self.browser.get_page_info()
            screenshot_b64 = await self.browser.screenshot()
            
            # Add current state to context
            state_info = f"\n\n--- Current State ---\nURL: {url}\nTitle: {title}\nContent Preview: {content[:2000]}..."
            
            if step_num == 0:
                messages[1]["content"] += state_info
            else:
                messages.append({"role": "user", "content": state_info})
            
            # Call LLM
            response = await self.llm.call(
                messages=messages,
                tools=self.tools.get_tool_schemas()
            )
            
            # Parse response
            thought, action, action_input = self._parse_response(response)
            
            console.print(f"[yellow]Thought:[/yellow] {thought[:200]}...")
            console.print(f"[green]Action:[/green] {action}")
            
            # Execute action
            observation = await self.tools.execute(action, action_input, self.browser)
            
            if observation:
                console.print(f"[dim]Observation: {observation[:150]}...[/dim]")
            
            # Store step
            step = AgentStep(
                thought=thought,
                action=action,
                action_input=action_input,
                observation=observation,
                screenshot=screenshot_b64
            )
            self.history.append(step)
            
            # Update messages
            messages.append({"role": "assistant", "content": f"Thought: {thought}\nAction: {action} {json.dumps(action_input)}"})
            messages.append({"role": "user", "content": f"Observation: {observation}"})
            
            # Check if task is complete
            if action == "terminate" or "task complete" in thought.lower():
                console.print(f"\n[bold green]✓ Task completed![/bold green]")
                return f"Task completed: {action_input.get('answer', 'Success')}"
        
        return f"Task completed after {self.max_steps} steps"
    
    def _build_system_prompt(self) -> str:
        """Build the system prompt"""
        return f"""You are an agentic browser AI that controls a web browser to complete tasks.

You have access to these tools:
{self.tools.get_tool_descriptions()}

Instructions:
1. Think step by step about what needs to be done
2. Use the available tools to interact with the browser
3. Take screenshots when you need to see the page state
4. Terminate when the task is complete with a success status

Always respond with:
- Thought: Your reasoning about what to do next
- Action: The tool name to use
- Action Input: The parameters for the tool in JSON format
"""
    
    def _parse_response(self, response: Dict) -> tuple:
        """Parse LLM response into thought, action, action_input"""
        content = response.get("content", "")
        
        # Check for tool calls
        if "tool_calls" in response:
            tool_call = response["tool_calls"][0]
            action = tool_call["function"]["name"]
            action_input = json.loads(tool_call["function"]["arguments"])
            thought = f"Using tool: {action}"
            return thought, action, action_input
        
        # Parse text response
        thought = ""
        action = "think"
        action_input = {"message": content}
        
        # Try to extract action from content
        if "navigate" in content.lower() and "http" in content:
            action = "navigate"
            # Extract URL
            import re
            urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', content)
            if urls:
                action_input = {"url": urls[0]}
        elif "click" in content.lower():
            action = "click"
            action_input = {"text": "Click target"}
        elif "type" in content.lower() or "fill" in content.lower():
            action = "type"
            action_input = {"selector": "input", "text": "sample text"}
        elif "done" in content.lower() or "complete" in content.lower():
            action = "terminate"
            action_input = {"answer": content}
        
        return thought, action, action_input


async def main():
    """Example usage"""
    import os
    
    # Get API key from environment
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    provider = "openai" if os.getenv("OPENAI_API_KEY") else "anthropic"
    
    if not api_key:
        console.print("[red]Please set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable[/red]")
        return
    
    # Create and run agent
    agent = AgenticAgent(
        task="Go to https://example.com and extract the heading text",
        llm_provider=provider,
        llm_api_key=api_key,
        headless=False  # Set to True to run in background
    )
    
    result = await agent.run()
    console.print(Panel(result, title="[bold green]Result[/bold green]", border_style="green"))


if __name__ == "__main__":
    asyncio.run(main())
