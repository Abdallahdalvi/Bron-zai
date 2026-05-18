"""
Example: Creating Custom Tools for Agentic Browser
You can extend the browser with your own custom actions
"""
from tools import ToolRegistry, tool
import json


class MyCustomTools(ToolRegistry):
    """Example of extending tools with custom functionality"""
    
    def __init__(self):
        super().__init__()
        self._register_custom_tools()
    
    def _register_custom_tools(self):
        """Add your custom tools here"""
        
        # Example: Extract all images from page
        self.register(
            name="extract_images",
            description="Extract all image URLs from the current page",
            parameters={
                "type": "object",
                "properties": {
                    "min_width": {
                        "type": "integer",
                        "description": "Minimum image width to include",
                        "default": 100
                    }
                },
                "required": []
            },
            function=self._extract_images
        )
        
        # Example: Fill a form with data
        self.register(
            name="fill_form",
            description="Fill a form with provided data",
            parameters={
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "description": "Key-value pairs of form field names and values"
                    }
                },
                "required": ["data"]
            },
            function=self._fill_form
        )
        
        # Example: Download a file
        self.register(
            name="download_file",
            description="Click an element to trigger file download",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for download link/button"
                    }
                },
                "required": ["selector"]
            },
            function=self._download_file
        )
        
        # Example: Check element exists
        self.register(
            name="element_exists",
            description="Check if an element exists on the page",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to check"
                    }
                },
                "required": ["selector"]
            },
            function=self._element_exists
        )
    
    # Custom tool implementations
    async def _extract_images(self, browser, min_width: int = 100) -> str:
        """Extract all images from page"""
        images = await browser.page.eval_on_selector_all("img", f"""
            elements => elements
                .filter(img => img.naturalWidth >= {min_width})
                .map(img => ({{
                    src: img.src,
                    alt: img.alt,
                    width: img.naturalWidth,
                    height: img.naturalHeight
                }}))
        """)
        return json.dumps(images[:20], indent=2)  # Limit to 20 images
    
    async def _fill_form(self, browser, data: dict) -> str:
        """Fill form fields with data"""
        results = []
        for field_name, value in data.items():
            # Try multiple selector strategies
            selectors = [
                f'input[name="{field_name}"]',
                f'textarea[name="{field_name}"]',
                f'#{field_name}',
                f'input[placeholder*="{field_name}" i]',
                f'[data-field="{field_name}"]'
            ]
            
            filled = False
            for selector in selectors:
                try:
                    if await browser.page.locator(selector).count() > 0:
                        await browser.type(selector, str(value))
                        results.append(f"Filled {field_name} with {value}")
                        filled = True
                        break
                except:
                    continue
            
            if not filled:
                results.append(f"Could not find field: {field_name}")
        
        return "\n".join(results)
    
    async def _download_file(self, browser, selector: str) -> str:
        """Click to download a file"""
        # Setup download handler
        async with browser.page.expect_download() as download_info:
            await browser.click(selector=selector)
            download = await download_info.value
        
        # Save download info
        path = await download.path()
        return f"File downloaded: {download.suggested_filename} to {path}"
    
    async def _element_exists(self, browser, selector: str) -> str:
        """Check if element exists"""
        count = await browser.page.locator(selector).count()
        exists = count > 0
        return json.dumps({"exists": exists, "count": count})


# Example usage in agent:
# from agent import AgenticAgent
# from custom_tools_example import MyCustomTools
#
# agent = AgenticAgent(...)
# agent.tools = MyCustomTools()  # Replace default tools with custom ones
# result = await agent.run()


if __name__ == "__main__":
    print("Custom tools example loaded!")
    print("Import MyCustomTools and use with AgenticAgent")
