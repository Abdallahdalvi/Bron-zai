"""
Tab Manager - Parallel Tab Management
Enables the agent to work with multiple pages simultaneously
"""
import asyncio
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from enum import Enum
from rich.console import Console
from browser import AgenticBrowser
import base64

console = Console()


class TabStatus(Enum):
    """Status of a tab"""
    IDLE = "idle"
    LOADING = "loading"
    ACTIVE = "active"
    ERROR = "error"
    CLOSED = "closed"


@dataclass
class Tab:
    """Represents a browser tab"""
    id: str
    url: str = ""
    title: str = ""
    status: TabStatus = TabStatus.IDLE
    created_at: float = field(default_factory=lambda: asyncio.get_event_loop().time())
    last_active: float = field(default_factory=lambda: asyncio.get_event_loop().time())
    page: Any = None  # Playwright page object
    context: str = ""  # Current page text content
    screenshot: Optional[str] = None
    group: Optional[str] = None  # Tab group name
    priority: int = 0  # Higher = more important
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "status": self.status.value,
            "group": self.group,
            "priority": self.priority
        }


class TabManager:
    """
    Manages multiple browser tabs/pages concurrently
    Similar to how BrowserOS handles multi-tab tasks
    """
    
    def __init__(self, browser: AgenticBrowser, max_tabs: int = 10):
        self.browser = browser
        self.max_tabs = max_tabs
        self.tabs: Dict[str, Tab] = {}
        self.active_tab_id: Optional[str] = None
        self._tab_counter = 0
        self._lock = asyncio.Lock()
        
    async def create_tab(
        self,
        url: Optional[str] = None,
        group: Optional[str] = None,
        priority: int = 0,
        activate: bool = False
    ) -> Tab:
        """Create a new tab"""
        async with self._lock:
            if len(self.tabs) >= self.max_tabs:
                # Close oldest inactive tab
                await self._cleanup_oldest_tab()
            
            self._tab_counter += 1
            tab_id = f"tab_{self._tab_counter}"
            
            # Create new page in browser context
            page = await self.browser.context.new_page()
            
            tab = Tab(
                id=tab_id,
                page=page,
                group=group,
                priority=priority
            )
            
            self.tabs[tab_id] = tab
            
            if url:
                tab.status = TabStatus.LOADING
                await page.goto(url)
                tab.url = page.url
                tab.title = await page.title()
                tab.status = TabStatus.IDLE
            
            if activate or not self.active_tab_id:
                self.active_tab_id = tab_id
                tab.status = TabStatus.ACTIVE
            
            console.print(f"[dim]Created tab {tab_id}: {tab.url or '(blank)'}[/dim]")
            return tab
    
    async def close_tab(self, tab_id: str) -> bool:
        """Close a specific tab"""
        async with self._lock:
            if tab_id not in self.tabs:
                return False
            
            tab = self.tabs[tab_id]
            
            try:
                await tab.page.close()
            except Exception as e:
                console.print(f"[dim]Error closing tab {tab_id}: {e}[/dim]")
            
            tab.status = TabStatus.CLOSED
            del self.tabs[tab_id]
            
            # Update active tab if needed
            if self.active_tab_id == tab_id:
                self.active_tab_id = next(iter(self.tabs.keys()), None)
                if self.active_tab_id:
                    self.tabs[self.active_tab_id].status = TabStatus.ACTIVE
            
            console.print(f"[dim]Closed tab {tab_id}[/dim]")
            return True
    
    async def switch_to_tab(self, tab_id: str) -> bool:
        """Switch to a different tab"""
        if tab_id not in self.tabs:
            return False
        
        # Deactivate current tab
        if self.active_tab_id and self.active_tab_id in self.tabs:
            self.tabs[self.active_tab_id].status = TabStatus.IDLE
        
        # Activate new tab
        self.active_tab_id = tab_id
        self.tabs[tab_id].status = TabStatus.ACTIVE
        self.tabs[tab_id].last_active = asyncio.get_event_loop().time()
        
        console.print(f"[dim]Switched to tab {tab_id}: {self.tabs[tab_id].title}[/dim]")
        return True
    
    def get_active_tab(self) -> Optional[Tab]:
        """Get the currently active tab"""
        if self.active_tab_id and self.active_tab_id in self.tabs:
            return self.tabs[self.active_tab_id]
        return None
    
    def get_active_page(self):
        """Get the Playwright page object for the active tab"""
        tab = self.get_active_tab()
        return tab.page if tab else None
    
    async def refresh_tab(self, tab_id: Optional[str] = None):
        """Refresh a tab's state"""
        tab = self.tabs.get(tab_id or self.active_tab_id)
        if not tab:
            return
        
        tab.url = tab.page.url
        tab.title = await tab.page.title()
        
        # Get text content
        try:
            body = await tab.page.query_selector("body")
            tab.context = await body.text_content() if body else ""
        except:
            tab.context = ""
    
    async def execute_on_tab(
        self,
        tab_id: str,
        action: Callable,
        *args,
        **kwargs
    ) -> Any:
        """Execute an action on a specific tab"""
        if tab_id not in self.tabs:
            raise ValueError(f"Tab {tab_id} not found")
        
        # Switch context to this tab
        original_active = self.active_tab_id
        await self.switch_to_tab(tab_id)
        
        try:
            # Execute action
            result = await action(*args, **kwargs)
            
            # Refresh tab state
            await self.refresh_tab(tab_id)
            
            return result
        finally:
            # Restore original active tab
            if original_active != tab_id:
                await self.switch_to_tab(original_active)
    
    async def execute_parallel(
        self,
        tasks: List[Dict[str, Any]]
    ) -> List[Any]:
        """
        Execute tasks across multiple tabs in parallel
        
        Args:
            tasks: List of {"tab_id": str, "action": Callable, "args": [], "kwargs": {}}
        
        Returns:
            List of results in same order
        """
        async def run_task(task_info):
            try:
                tab_id = task_info["tab_id"]
                action = task_info["action"]
                args = task_info.get("args", [])
                kwargs = task_info.get("kwargs", {})
                
                result = await self.execute_on_tab(tab_id, action, *args, **kwargs)
                return {"tab_id": tab_id, "result": result, "error": None}
            except Exception as e:
                return {"tab_id": tab_id, "result": None, "error": str(e)}
        
        # Run all tasks concurrently
        results = await asyncio.gather(*[run_task(t) for t in tasks])
        return results
    
    async def group_tabs(self, tab_ids: List[str], group_name: str):
        """Organize tabs into a named group"""
        for tab_id in tab_ids:
            if tab_id in self.tabs:
                self.tabs[tab_id].group = group_name
        console.print(f"[dim]Grouped tabs {tab_ids} into '{group_name}'[/dim]")
    
    async def close_group(self, group_name: str):
        """Close all tabs in a group"""
        tabs_to_close = [
            tab_id for tab_id, tab in self.tabs.items()
            if tab.group == group_name
        ]
        for tab_id in tabs_to_close:
            await self.close_tab(tab_id)
        console.print(f"[dim]Closed group '{group_name}' ({len(tabs_to_close)} tabs)[/dim]")
    
    async def wait_for_all_loading(self, timeout: float = 30.0):
        """Wait for all loading tabs to complete"""
        start = asyncio.get_event_loop().time()
        
        while True:
            loading_tabs = [
                tab for tab in self.tabs.values()
                if tab.status == TabStatus.LOADING
            ]
            
            if not loading_tabs:
                break
            
            if asyncio.get_event_loop().time() - start > timeout:
                console.print(f"[yellow]Timeout waiting for {len(loading_tabs)} tabs[/yellow]")
                break
            
            await asyncio.sleep(0.5)
    
    async def _cleanup_oldest_tab(self):
        """Close the oldest inactive tab"""
        inactive_tabs = [
            (tab_id, tab) for tab_id, tab in self.tabs.items()
            if tab.status == TabStatus.IDLE and tab_id != self.active_tab_id
        ]
        
        if inactive_tabs:
            # Sort by last active time
            inactive_tabs.sort(key=lambda x: x[1].last_active)
            oldest_id = inactive_tabs[0][0]
            await self.close_tab(oldest_id)
    
    def list_tabs(self) -> List[Dict[str, Any]]:
        """List all tabs with their status"""
        return [tab.to_dict() for tab in self.tabs.values()]
    
    def get_tabs_by_group(self, group: str) -> List[Tab]:
        """Get all tabs in a group"""
        return [tab for tab in self.tabs.values() if tab.group == group]
    
    async def screenshot_all(self) -> Dict[str, str]:
        """Take screenshots of all tabs"""
        screenshots = {}
        for tab_id, tab in self.tabs.items():
            try:
                screenshot_bytes = await tab.page.screenshot()
                screenshots[tab_id] = base64.b64encode(screenshot_bytes).decode()
            except Exception as e:
                console.print(f"[dim]Failed to screenshot {tab_id}: {e}[/dim]")
        return screenshots
    
    async def close_all(self):
        """Close all tabs"""
        for tab_id in list(self.tabs.keys()):
            await self.close_tab(tab_id)
        self.active_tab_id = None


class ParallelSearchManager:
    """
    High-level helper for parallel search tasks across multiple sites
    """
    
    def __init__(self, tab_manager: TabManager):
        self.tab_manager = tab_manager
        
    async def search_multiple(
        self,
        query: str,
        sites: List[str],
        extract_func: Optional[Callable] = None
    ) -> List[Dict[str, Any]]:
        """
        Search the same query across multiple sites in parallel
        
        Args:
            query: Search query
            sites: List of URLs to search
            extract_func: Optional function to extract results from each page
        
        Returns:
            List of results from each site
        """
        # Create tabs for each site
        tabs = []
        for site in sites:
            tab = await self.tab_manager.create_tab(url=site, group="search")
            tabs.append(tab)
        
        # Wait for all to load
        await self.tab_manager.wait_for_all_loading()
        
        # Perform search on each tab
        # This is a simplified version - real implementation would
        # use site-specific search selectors
        results = []
        
        for tab in tabs:
            try:
                # Default extraction: get page text
                if extract_func:
                    result = await extract_func(tab.page)
                else:
                    body = await tab.page.query_selector("body")
                    text = await body.text_content() if body else ""
                    result = {"text": text[:1000], "url": tab.url}
                
                results.append({
                    "site": tab.url,
                    "result": result,
                    "tab_id": tab.id
                })
            except Exception as e:
                results.append({
                    "site": tab.url,
                    "error": str(e),
                    "tab_id": tab.id
                })
        
        return results
    
    async def compare_pages(
        self,
        urls: List[str],
        comparison_prompt: str = "Compare these pages"
    ) -> Dict[str, Any]:
        """
        Load multiple pages and provide comparison data
        """
        # Create tabs
        for url in urls:
            await self.tab_manager.create_tab(url=url, group="comparison")
        
        await self.tab_manager.wait_for_all_loading()
        
        # Get screenshots and text from all pages
        comparison_data = []
        for tab_id, tab in self.tab_manager.tabs.items():
            if tab.group == "comparison":
                screenshot_b64 = await tab.page.screenshot()
                body = await tab.page.query_selector("body")
                text = await body.text_content() if body else ""
                
                comparison_data.append({
                    "url": tab.url,
                    "title": tab.title,
                    "screenshot": base64.b64encode(screenshot_b64).decode(),
                    "text_preview": text[:2000],
                    "tab_id": tab_id
                })
        
        return {
            "pages": comparison_data,
            "comparison_prompt": comparison_prompt
        }
