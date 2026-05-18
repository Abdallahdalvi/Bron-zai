"""
Tool Registry - Actions the agent can perform
Similar to BrowserOS's tool system
"""
import json
from typing import Dict, Any, Callable, Optional, List
from dataclasses import dataclass


@dataclass
class Tool:
    """Tool definition"""
    name: str
    description: str
    parameters: Dict[str, Any]
    function: Callable


class ToolRegistry:
    """
    Registry of available tools for the agent
    """
    
    def __init__(self):
        self.tools: Dict[str, Tool] = {}
        self._register_default_tools()
    
    def register(self, name: str, description: str, parameters: Dict[str, Any], function: Callable):
        """Register a new tool"""
        self.tools[name] = Tool(
            name=name,
            description=description,
            parameters=parameters,
            function=function
        )
    
    def _register_default_tools(self):
        """Register default browser tools"""
        
        # Navigate tool
        self.register(
            name="navigate",
            description="Navigate to a URL",
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Full URL to navigate to"
                    }
                },
                "required": ["url"]
            },
            function=self._navigate
        )
        
        # Click tool
        self.register(
            name="click",
            description="Click on an element. Prefer using element_id if available.",
            parameters={
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "integer",
                        "description": "Visual tag ID of the element to click"
                    },
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element (fallback)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text content to click on (fallback)"
                    }
                },
                "required": []
            },
            function=self._click
        )
        
        # Type tool
        self.register(
            name="type",
            description="Type text into an input field. Prefer using element_id if available.",
            parameters={
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "integer",
                        "description": "Visual tag ID of the input field"
                    },
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the input (fallback)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type"
                    },
                    "clear": {
                        "type": "boolean",
                        "description": "Clear field before typing",
                        "default": True
                    }
                },
                "required": ["text"]
            },
            function=self._type
        )
        
        # Get text tool
        self.register(
            name="get_text",
            description="Get text content from the page or a specific element",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector (optional, gets full page if omitted)"
                    }
                },
                "required": []
            },
            function=self._get_text
        )
        
        # Scroll tool
        self.register(
            name="scroll",
            description="Scroll the page",
            parameters={
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["up", "down", "left", "right"],
                        "default": "down"
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Number of scroll ticks",
                        "default": 3
                    }
                },
                "required": []
            },
            function=self._scroll
        )
        
        # Screenshot tool
        self.register(
            name="screenshot",
            description="Take a screenshot of the current page",
            parameters={
                "type": "object",
                "properties": {
                    "full_page": {
                        "type": "boolean",
                        "description": "Capture full scrollable page",
                        "default": False
                    }
                },
                "required": []
            },
            function=self._screenshot
        )
        
        # Extract links tool
        self.register(
            name="extract_links",
            description="Extract all links from the current page",
            parameters={
                "type": "object",
                "properties": {},
                "required": []
            },
            function=self._extract_links
        )
        
        # Press key tool
        self.register(
            name="press_key",
            description="Press a keyboard key (e.g., Enter, Escape, Tab)",
            parameters={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Key to press"
                    }
                },
                "required": ["key"]
            },
            function=self._press_key
        )
        
        # Wait tool
        self.register(
            name="wait",
            description="Wait for a specified duration",
            parameters={
                "type": "object",
                "properties": {
                    "seconds": {
                        "type": "integer",
                        "description": "Seconds to wait",
                        "default": 2
                    }
                },
                "required": []
            },
            function=self._wait
        )
        
        # Go back tool
        self.register(
            name="go_back",
            description="Navigate back in browser history",
            parameters={
                "type": "object",
                "properties": {},
                "required": []
            },
            function=self._go_back
        )
        
        # Get page info tool
        self.register(
            name="get_page_info",
            description="Get current page URL and title",
            parameters={
                "type": "object",
                "properties": {},
                "required": []
            },
            function=self._get_page_info
        )
        
        # Think tool
        self.register(
            name="think",
            description="Think about the current state and plan next steps",
            parameters={
                "type": "object",
                "properties": {
                    "thought": {
                        "type": "string",
                        "description": "Your thought process"
                    }
                },
                "required": ["thought"]
            },
            function=self._think
        )
        
        # Terminate tool
        self.register(
            name="terminate",
            description="Terminate the task with a success status",
            parameters={
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "Final answer or summary"
                    }
                },
                "required": ["answer"]
            },
            function=self._terminate
        )

        # Evaluate script tool
        self.register(
            name="evaluate_script",
            description="Execute JavaScript on the page and return the result. Use as a fallback when CSS selectors fail.",
            parameters={
                "type": "object",
                "properties": {
                    "script": {
                        "type": "string",
                        "description": "JavaScript code to execute. Must return a serializable value."
                    }
                },
                "required": ["script"]
            },
            function=self._evaluate_script
        )

        # Get DOM tool
        self.register(
            name="get_dom",
            description="Get the raw HTML DOM of the current page. Use to find correct CSS selectors when elements are hard to locate.",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "Optional CSS selector to get outerHTML of a specific element instead of full page"
                    }
                },
                "required": []
            },
            function=self._get_dom
        )

        # Hover tool
        self.register(
            name="hover",
            description="Hover the mouse over an element to trigger hover menus or tooltips. Prefer using element_id if available.",
            parameters={
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "integer",
                        "description": "Visual tag ID of the element"
                    },
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to hover over (fallback)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text content to hover over (alternative fallback)"
                    }
                },
                "required": []
            },
            function=self._hover
        )

        # Select option tool
        self.register(
            name="select_option",
            description="Select an option from a <select> dropdown element",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the <select> element"
                    },
                    "value": {
                        "type": "string",
                        "description": "The option value or label to select"
                    }
                },
                "required": ["selector", "value"]
            },
            function=self._select_option
        )

        # Wait for element tool
        self.register(
            name="wait_for_element",
            description="Wait for a CSS selector to appear in the DOM. Use after navigating or triggering async loads.",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to wait for"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Maximum wait time in milliseconds (default: 5000)",
                        "default": 5000
                    }
                },
                "required": ["selector"]
            },
            function=self._wait_for_element
        )

        # Drag-and-drop tool
        self.register(
            name="drag_drop",
            description="Drag an element from a source to a target element. Use for reordering lists, kanban cards, or file uploads.",
            parameters={
                "type": "object",
                "properties": {
                    "source_selector": {
                        "type": "string",
                        "description": "CSS selector for the element to drag"
                    },
                    "target_selector": {
                        "type": "string",
                        "description": "CSS selector for the drop target element"
                    }
                },
                "required": ["source_selector", "target_selector"]
            },
            function=self._drag_drop
        )

        # Right-click context menu tool
        self.register(
            name="right_click",
            description="Right-click an element to open its context menu. Prefer using element_id if available.",
            parameters={
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "integer",
                        "description": "Visual tag ID of the element"
                    },
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to right-click (fallback)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text content of the element to right-click (alternative fallback)"
                    }
                },
                "required": []
            },
            function=self._right_click
        )

        # Shadow DOM click tool
        self.register(
            name="click_shadow",
            description=(
                "Click an element that lives inside a Shadow DOM root. "
                "Use when normal click fails on Web Components or custom elements."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to search for inside shadow roots"
                    }
                },
                "required": ["selector"]
            },
            function=self._click_shadow
        )

        # Shadow DOM query tool
        self.register(
            name="query_shadow",
            description=(
                "Find and return the outerHTML of an element inside a Shadow DOM. "
                "Use to inspect Web Components when get_dom cannot locate the element."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to search for inside shadow roots"
                    }
                },
                "required": ["selector"]
            },
            function=self._query_shadow
        )

        # Switch into iframe tool
        self.register(
            name="switch_to_frame",
            description=(
                "Switch all subsequent interactions (click, type, get_text) into an iframe. "
                "Use when target elements are inside an <iframe> tag."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the <iframe> element (e.g. 'iframe#payment')"
                    }
                },
                "required": ["selector"]
            },
            function=self._switch_to_frame
        )

        # Return to main frame tool
        self.register(
            name="switch_to_main_frame",
            description="Exit the active iframe context and return to the top-level page.",
            parameters={
                "type": "object",
                "properties": {},
                "required": []
            },
            function=self._switch_to_main_frame
        )

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Get tool schemas for LLM"""
        schemas = []
        for tool in self.tools.values():
            schemas.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            })
        return schemas
    
    def get_tool_descriptions(self) -> str:
        """Get formatted tool descriptions"""
        descriptions = []
        for name, tool in self.tools.items():
            params = json.dumps(tool.parameters.get("properties", {}), indent=2)
            descriptions.append(f"- {name}: {tool.description}\n  Parameters: {params}")
        return "\n".join(descriptions)
    
    async def execute(self, tool_name: str, params: Dict[str, Any], browser) -> Optional[str]:
        """Execute a tool"""
        if tool_name not in self.tools:
            return f"Unknown tool: {tool_name}"
        
        tool = self.tools[tool_name]
        
        try:
            result = await tool.function(browser, **params)
            return result
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"
    
    # Tool implementations
    async def _navigate(self, browser, url: str) -> str:
        return await browser.navigate(url)
    
    async def _click(self, browser, element_id: Optional[int] = None, selector: Optional[str] = None, text: Optional[str] = None) -> str:
        coords = None
        if element_id is not None and hasattr(browser, 'element_map') and element_id in browser.element_map:
            el_info = browser.element_map[element_id]
            coords = (el_info["center_x"], el_info["center_y"])
            if not selector:
                selector = el_info.get("selector")
        return await browser.click(selector=selector, text=text, coordinates=coords)
    
    async def _type(self, browser, text: str, element_id: Optional[int] = None, selector: Optional[str] = None, clear: bool = True) -> str:
        if element_id is not None and hasattr(browser, 'element_map') and element_id in browser.element_map:
            el_info = browser.element_map[element_id]
            # If we only have coordinates, we must click then type
            if not el_info.get("selector") and not selector:
                coords = (el_info["center_x"], el_info["center_y"])
                await browser.click(coordinates=coords)
                return await browser.press_key("End") # basic fallback
            if not selector:
                selector = el_info.get("selector")
                
        if not selector:
            return "Error: type tool requires either a valid element_id with a selector or a direct selector."
        return await browser.type(selector, text, clear)
    
    async def _get_text(self, browser, selector: Optional[str] = None) -> str:
        text = await browser.get_text(selector)
        return text[:2000] if len(text) > 2000 else text
    
    async def _scroll(self, browser, direction: str = "down", amount: int = 3) -> str:
        return await browser.scroll(direction, amount)
    
    async def _screenshot(self, browser, full_page: bool = False) -> str:
        screenshot_b64 = await browser.screenshot(full_page)
        return f"Screenshot captured ({len(screenshot_b64)} bytes)"
    
    async def _extract_links(self, browser) -> str:
        links = await browser.extract_links()
        return json.dumps(links[:10], indent=2)  # Limit to first 10
    
    async def _press_key(self, browser, key: str) -> str:
        return await browser.press_key(key)
    
    async def _wait(self, browser, seconds: int = 2) -> str:
        import asyncio
        await asyncio.sleep(seconds)
        return f"Waited {seconds} seconds"
    
    async def _go_back(self, browser) -> str:
        return await browser.go_back()
    
    async def _get_page_info(self, browser) -> str:
        url, title, _ = await browser.get_page_info()
        return f"URL: {url}\nTitle: {title}"
    
    async def _think(self, browser, thought: str) -> str:
        return f"Thought: {thought}"
    
    async def _terminate(self, browser, answer: str) -> str:
        return f"Task complete: {answer}"

    async def _evaluate_script(self, browser, script: str) -> str:
        try:
            result = await browser.evaluate(script)
            result_str = str(result) if result is not None else "null"
            return f"Script result: {result_str[:2000]}"
        except Exception as e:
            return f"Script error: {str(e)}"

    async def _get_dom(self, browser, selector: Optional[str] = None) -> str:
        try:
            if selector:
                dom = await browser.evaluate(
                    f"document.querySelector('{selector}')?.outerHTML || 'Element not found'"
                )
            else:
                dom = await browser.get_dom()
            # Truncate and clean for LLM consumption
            return dom[:3000] if dom else "Empty DOM"
        except Exception as e:
            return f"DOM error: {str(e)}"

    async def _hover(self, browser, element_id: Optional[int] = None, selector: Optional[str] = None, text: Optional[str] = None) -> str:
        try:
            if element_id is not None and hasattr(browser, 'element_map') and element_id in browser.element_map:
                el_info = browser.element_map[element_id]
                if not selector:
                    selector = el_info.get("selector")
                if not selector:
                    # Hover by coordinates
                    coords = (el_info["center_x"], el_info["center_y"])
                    await browser.page.mouse.move(coords[0], coords[1])
                    return f"Hovered over element {element_id} at coordinates"
            
            if text:
                selector = f'text={text}'
            if not selector:
                return "No hover target specified"
            await browser.page.hover(selector)
            return f"Hovered over: {selector}"
        except Exception as e:
            return f"Hover error: {str(e)}"

    async def _select_option(self, browser, selector: str, value: str) -> str:
        try:
            return await browser.select_option(selector, value)
        except Exception as e:
            # Try label-based selection as fallback
            try:
                await browser.page.select_option(selector, label=value)
                return f"Selected option '{value}' by label in {selector}"
            except Exception as e2:
                return f"Select error: {str(e2)}"

    async def _wait_for_element(self, browser, selector: str, timeout: int = 5000) -> str:
        found = await browser.wait_for_selector(selector, timeout=timeout)
        if found:
            return f"Element '{selector}' appeared"
        return f"Timeout: element '{selector}' did not appear within {timeout}ms"

    async def _drag_drop(self, browser, source_selector: str, target_selector: str) -> str:
        try:
            return await browser.drag_drop(source_selector, target_selector)
        except Exception as e:
            return f"drag_drop error: {str(e)}"

    async def _right_click(
        self,
        browser,
        element_id: Optional[int] = None,
        selector: Optional[str] = None,
        text: Optional[str] = None
    ) -> str:
        try:
            coords = None
            if element_id is not None and hasattr(browser, 'element_map') and element_id in browser.element_map:
                el_info = browser.element_map[element_id]
                coords = (el_info["center_x"], el_info["center_y"])
                if not selector:
                    selector = el_info.get("selector")
                    
            if text and not selector:
                selector = f"text={text}"
            return await browser.right_click(selector=selector, coordinates=coords)
        except Exception as e:
            return f"right_click error: {str(e)}"

    async def _click_shadow(self, browser, selector: str) -> str:
        try:
            return await browser.click_shadow(selector)
        except Exception as e:
            return f"click_shadow error: {str(e)}"

    async def _query_shadow(self, browser, selector: str) -> str:
        try:
            result = await browser.query_shadow(selector)
            if result:
                return f"Found in Shadow DOM: {result}"
            return f"Element not found in Shadow DOM: {selector}"
        except Exception as e:
            return f"query_shadow error: {str(e)}"

    async def _switch_to_frame(self, browser, selector: str) -> str:
        try:
            return await browser.switch_to_frame(selector)
        except Exception as e:
            return f"switch_to_frame error: {str(e)}"

    async def _switch_to_main_frame(self, browser) -> str:
        try:
            return await browser.switch_to_main_frame()
        except Exception as e:
            return f"switch_to_main_frame error: {str(e)}"


# Custom tool decorator for easy extension
def tool(name: str, description: str, parameters: Dict[str, Any]):
    """Decorator to register custom tools"""
    def decorator(func):
        func._tool_name = name
        func._tool_description = description
        func._tool_parameters = parameters
        return func
    return decorator
