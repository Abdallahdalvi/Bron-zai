"""
Vision Module - Screenshot Analysis with Multimodal LLMs
Enables the agent to 'see' and understand web pages visually
"""
import base64
import asyncio
from typing import Optional, List, Dict, Any
import httpx
from rich.console import Console

console = Console()


class VisionAnalyzer:
    """
    Analyzes screenshots using multimodal LLMs (GPT-4V, Claude 3 Vision)
    """
    
    def __init__(self, provider: str = "openai", api_key: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        self.client = httpx.AsyncClient(timeout=120.0)
    
    async def analyze_screenshot(
        self,
        screenshot_b64: str,
        task: str,
        previous_actions: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Analyze a screenshot and provide guidance
        
        Returns:
            {
                "description": "What is visible in the screenshot",
                "next_action": "suggested next action",
                "elements": [{"type": "button", "location": "top-right", "text": "Submit"}],
                "confidence": 0.85
            }
        """
        if self.provider == "openai":
            return await self._analyze_with_openai(screenshot_b64, task, previous_actions)
        elif self.provider == "anthropic":
            return await self._analyze_with_anthropic(screenshot_b64, task, previous_actions)
        else:
            raise ValueError(f"Vision not supported for provider: {self.provider}")
    
    async def _analyze_with_openai(
        self,
        screenshot_b64: str,
        task: str,
        previous_actions: Optional[List[str]]
    ) -> Dict[str, Any]:
        """Analyze using GPT-4 Vision"""
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Build context from previous actions
        context = ""
        if previous_actions:
            context = "Previous actions:\n" + "\n".join(f"- {a}" for a in previous_actions[-5:])
        
        payload = {
            "model": "gpt-4o-mini",  # Vision model
            "messages": [
                {
                    "role": "system",
                    "content": """You are a web automation assistant. Analyze the screenshot and provide structured guidance.
                    
Respond in this JSON format:
{
    "description": "Brief description of what's visible",
    "page_state": "loading|interactive|error|success",
    "ui_elements": [
        {"type": "button|input|link|text", "location": "approximate position", "text": "visible text", "action": "what clicking would do"}
    ],
    "suggested_action": "The most logical next action",
    "target_element": "Description of what to interact with",
    "confidence": 0.0-1.0,
    "task_progress": "not started|in progress|almost done|complete"
}"""
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Task: {task}\n\n{context}\n\nAnalyze this screenshot and guide the next action."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_b64}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 1000,
            "temperature": 0.3
        }
        
        try:
            response = await self.client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()
            
            content = result["choices"][0]["message"]["content"]
            
            # Try to parse JSON from content
            import json
            try:
                # Extract JSON if wrapped in markdown
                if "```json" in content:
                    json_str = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    json_str = content.split("```")[1].split("```")[0]
                else:
                    json_str = content
                
                analysis = json.loads(json_str.strip())
                return analysis
            except json.JSONDecodeError:
                # Return raw content if not valid JSON
                return {
                    "description": content,
                    "page_state": "unknown",
                    "ui_elements": [],
                    "suggested_action": "Analyze the page content",
                    "target_element": "",
                    "confidence": 0.5,
                    "task_progress": "unknown"
                }
                
        except Exception as e:
            console.print(f"[red]Vision analysis error: {e}[/red]")
            return {
                "description": f"Error analyzing screenshot: {e}",
                "page_state": "error",
                "ui_elements": [],
                "suggested_action": "Retry with text-based analysis",
                "target_element": "",
                "confidence": 0.0,
                "task_progress": "unknown"
            }
    
    async def _analyze_with_anthropic(
        self,
        screenshot_b64: str,
        task: str,
        previous_actions: Optional[List[str]]
    ) -> Dict[str, Any]:
        """Analyze using Claude 3 Vision"""
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }
        
        context = ""
        if previous_actions:
            context = "Previous actions:\n" + "\n".join(f"- {a}" for a in previous_actions[-5:])
        
        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": 1000,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"""You are a web automation assistant. Analyze the screenshot and respond in JSON format.

Task: {task}
{context}

Respond ONLY with this JSON structure:
{{
    "description": "Brief description of what's visible",
    "page_state": "loading|interactive|error|success",
    "ui_elements": [
        {{"type": "button|input|link|text", "location": "approximate position", "text": "visible text"}}
    ],
    "suggested_action": "The most logical next action",
    "target_element": "Description of what to interact with",
    "confidence": 0.0-1.0,
    "task_progress": "not started|in progress|almost done|complete"
}}"""
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": screenshot_b64
                            }
                        }
                    ]
                }
            ]
        }
        
        try:
            response = await self.client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()
            
            content = result["content"][0]["text"]
            
            import json
            try:
                if "```json" in content:
                    json_str = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    json_str = content.split("```")[1].split("```")[0]
                else:
                    json_str = content
                
                return json.loads(json_str.strip())
            except json.JSONDecodeError:
                return {
                    "description": content,
                    "page_state": "unknown",
                    "ui_elements": [],
                    "suggested_action": "Analyze the page content",
                    "target_element": "",
                    "confidence": 0.5,
                    "task_progress": "unknown"
                }
                
        except Exception as e:
            console.print(f"[red]Vision analysis error: {e}[/red]")
            return {
                "description": f"Error: {e}",
                "page_state": "error",
                "ui_elements": [],
                "suggested_action": "Use text analysis",
                "target_element": "",
                "confidence": 0,
                "task_progress": "unknown"
            }
    
    async def find_element(
        self,
        screenshot_b64: str,
        element_description: str,
        viewport_width: int = 1280,
        viewport_height: int = 800,
    ) -> Optional[Dict[str, int]]:
        """
        Find pixel coordinates of a UI element using multimodal visual grounding.
        Returns: {"x": int, "y": int} or None if the element could not be located.
        """
        prompt_text = (
            f"You are a web UI element locator. "
            f'Look at the screenshot and find: "{element_description}". '
            f'Respond ONLY with JSON: {{"x": <pixel_x>, "y": <pixel_y>}}. '
            f'If not found respond with: {{"x": null, "y": null}}'
        )
        try:
            if self.provider == "openai":
                raw = await self._grounding_call_openai(screenshot_b64, prompt_text)
            elif self.provider == "anthropic":
                raw = await self._grounding_call_anthropic(screenshot_b64, prompt_text)
            else:
                return None
            import json as _json
            raw_clean = raw.strip()
            if "```" in raw_clean:
                parts = raw_clean.split("```")
                raw_clean = parts[1] if len(parts) > 1 else raw_clean
                if raw_clean.startswith("json"):
                    raw_clean = raw_clean[4:]
            data = _json.loads(raw_clean)
            x, y = data.get("x"), data.get("y")
            if x is None or y is None:
                return None
            x, y = int(x), int(y)
            if 0 < x < viewport_width and 0 < y < viewport_height:
                return {"x": x, "y": y}
        except Exception as e:
            console.print(f"[dim]find_element failed: {e}[/dim]")
        return None

    async def _grounding_call_openai(self, screenshot_b64: str, prompt: str) -> str:
        """Multimodal OpenAI call for coordinate grounding (uses gpt-4o for spatial reasoning)."""
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {
                    "url": f"data:image/png;base64,{screenshot_b64}", "detail": "high"}},
            ]}],
            "max_tokens": 64,
            "temperature": 0.0,
        }
        resp = await self.client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    async def _grounding_call_anthropic(self, screenshot_b64: str, prompt: str) -> str:
        """Multimodal Anthropic call for coordinate grounding (uses Claude 3.5 Sonnet)."""
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
        payload = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 64,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/png", "data": screenshot_b64}},
                {"type": "text", "text": prompt},
            ]}],
        }
        resp = await self.client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]


class VisionEnabledAgentMixin:
    """
    Mixin to add vision capabilities to the agent
    Include screenshots in every LLM call for visual reasoning
    """
    
    def __init__(self, *args, use_vision: bool = True, **kwargs):
        super().__init__(*args, **kwargs)
        self.use_vision = use_vision
        self.vision_analyzer = None
        if use_vision:
            self.vision_analyzer = VisionAnalyzer(self.llm.provider, self.llm.api_key)
    
    async def get_enhanced_context(self, screenshot_b64: str) -> str:
        """Get visual analysis of current state"""
        if not self.use_vision or not self.vision_analyzer:
            return ""
        
        previous_actions = [f"{s.action}: {s.action_input}" for s in self.history]
        
        analysis = await self.vision_analyzer.analyze_screenshot(
            screenshot_b64,
            self.task,
            previous_actions
        )
        
        # Format analysis as context
        context = f"""
Visual Analysis:
- Description: {analysis.get('description', 'N/A')}
- Page State: {analysis.get('page_state', 'unknown')}
- Task Progress: {analysis.get('task_progress', 'unknown')}
- Suggested Action: {analysis.get('suggested_action', 'N/A')}
"""
        
        # Add UI elements if available
        elements = analysis.get('ui_elements', [])
        if elements:
            context += "\nVisible UI Elements:\n"
            for elem in elements[:5]:  # Limit to 5 elements
                context += f"- {elem.get('type', 'unknown')}: {elem.get('text', 'unnamed')} ({elem.get('location', 'unknown')})\n"
        
        return context
