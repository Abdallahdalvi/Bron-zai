"""
Browser Controller - CDP-based browser automation
Using Playwright for cross-browser support

Key capabilities:
  • Self-healing click (coords → CSS → text → JS fallback)
  • iframe routing — switch_to_frame() wires ALL interactions into the frame
  • Shadow DOM piercing — query_shadow() traverses open shadow roots
  • Anti-bot hardening — canvas/WebGL/audio noise, human-like mouse & typing
"""
import asyncio
import math
import random
import json
from typing import Optional, Dict, Any, Tuple, List, Union
from playwright.async_api import (
    async_playwright, Page, Browser, BrowserContext,
    FrameLocator, Frame
)
import base64
from PIL import Image  # noqa: F401  (kept for callers that import it)

# ── Anti-bot evasion init script ─────────────────────────────────────────────
# Injected into every page before any JS runs.
_ANTI_BOT_SCRIPT = """
(function () {
  // 1. Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. Restore chrome runtime stub
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };

  // 3. Canvas fingerprint noise — perturb each pixel by ±1 on getImageData
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(...args) {
    const data = origGetImageData.apply(this, args);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i]   = Math.min(255, data.data[i]   + (Math.random() > 0.5 ? 1 : -1));
      data.data[i+1] = Math.min(255, data.data[i+1] + (Math.random() > 0.5 ? 1 : -1));
      data.data[i+2] = Math.min(255, data.data[i+2] + (Math.random() > 0.5 ? 1 : -1));
    }
    return data;
  };

  // 4. WebGL renderer/vendor noise
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';          // VENDOR
    if (param === 37446) return 'Intel Iris OpenGL Engine'; // RENDERER
    return getParam.call(this, param);
  };

  // 5. AudioContext sample noise
  const origGetChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function(channel) {
    const arr = origGetChannelData.call(this, channel);
    for (let i = 0; i < arr.length; i += 100) {
      arr[i] += (Math.random() - 0.5) * 0.0001;
    }
    return arr;
  };

  // 6. Plugins / mimeTypes stubs (empty in headless)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5].map(i => ({
      name: 'Plugin ' + i, filename: 'plugin' + i + '.dll',
      description: '', length: 0
    }))
  });

  // 7. Language / platform
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'platform',  { get: () => 'Win32' });
})();
"""

# ── Shadow DOM query helper (injected at query time) ──────────────────────────
_SHADOW_QUERY_SCRIPT = """
(function(selector) {
  function queryShadow(root, sel) {
    const direct = root.querySelector(sel);
    if (direct) return direct;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const found = queryShadow(el.shadowRoot, sel);
        if (found) return found;
      }
    }
    return null;
  }
  return queryShadow(document, selector);
})
"""


class AgenticBrowser:
    """
    Browser controller with CDP integration.
    Similar to BrowserOS's browser abstraction.
    """

    def __init__(self, headless: bool = False, viewport: Dict = None):
        self.headless = headless
        self.viewport = viewport or {"width": 1280, "height": 800}
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        # Active iframe — set by switch_to_frame(), cleared by switch_to_main_frame()
        self._active_frame: Optional[FrameLocator] = None
        self._active_frame_selector: Optional[str] = None
        # Visual element map (Skyvern method)
        self.element_map: Dict[int, Dict] = {}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _locator_root(self):
        """Return the active frame locator or the top-level page."""
        return self._active_frame if self._active_frame else self.page

    async def start(self):
        """Initialize the browser with anti-bot hardening."""
        self.playwright = await async_playwright().start()

        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            # Prevent GPU fingerprinting differences
            "--disable-gpu-sandbox",
            "--use-gl=swiftshader",
        ]
        if self.headless:
            launch_args.append("--headless=new")

        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=launch_args
        )

        self.context = await self.browser.new_context(
            viewport=self.viewport,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/New_York",
        )

        self.page = await self.context.new_page()
        self.cdp_session = await self.context.new_cdp_session(self.page)

        # Inject anti-bot evasion into every new page/frame before JS runs
        await self.context.add_init_script(_ANTI_BOT_SCRIPT)

    async def close(self):
        """Close browser and cleanup."""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    # ── Navigation ────────────────────────────────────────────────────────────

    async def navigate(self, url: str, wait_until: str = "networkidle") -> str:
        """Navigate to URL. Always operates on the top-level page."""
        if not self.page:
            raise RuntimeError("Browser not started")
        response = await self.page.goto(url, wait_until=wait_until)
        # Clear frame context on navigation
        self._active_frame = None
        self._active_frame_selector = None
        return f"Navigated to {url} (status: {response.status if response else 'unknown'})"

    # ── Click (iframe-aware, shadow-aware, self-healing) ─────────────────────

    async def click(
        self,
        selector: Optional[str] = None,
        text: Optional[str] = None,
        coordinates: Optional[Tuple[int, int]] = None,
        description: Optional[str] = None
    ) -> str:
        """
        Click element with frame-aware, shadow-aware, 5-stage fallback:
          Stage 1: Coordinate click (pixel-perfect, bypasses all selectors)
          Stage 2: CSS selector via active frame / page
          Stage 3: Text-content locator
          Stage 4: Shadow DOM pierce via JS helper
          Stage 5: JavaScript .click() as last resort
        """
        if coordinates:
            await self.page.mouse.click(coordinates[0], coordinates[1])
            return f"Clicked at coordinates ({coordinates[0]}, {coordinates[1]})"

        errors: List[str] = []
        root = self._locator_root()

        # Stage 2: CSS selector
        if selector and not selector.startswith("text="):
            try:
                await root.locator(selector).first.click(timeout=5000)
                return f"Clicked element: {selector}"
            except Exception as e:
                errors.append(f"selector failed: {e}")

        # Stage 3: Text-content locator
        text_target = text or (
            selector.replace("text=", "") if selector and selector.startswith("text=") else None
        )
        if text_target:
            try:
                await root.get_by_text(text_target, exact=False).first.click(timeout=5000)
                return f"Clicked by text: '{text_target}'"
            except Exception as e:
                errors.append(f"text locator failed: {e}")

        # Stage 4: Shadow DOM pierce
        if selector:
            try:
                clicked = await self.page.evaluate(
                    f"{_SHADOW_QUERY_SCRIPT}('{selector.replace(chr(39), chr(92)+chr(39))}')"
                    " !== null && "
                    f"(()=>{{ const el={_SHADOW_QUERY_SCRIPT}("
                    f"'{selector.replace(chr(39), chr(92)+chr(39))}'); "
                    "if(el){el.click(); return true;} return false; }})()"
                )
                if clicked:
                    return f"Clicked via Shadow DOM pierce: {selector}"
                errors.append("Shadow DOM: element not found")
            except Exception as e:
                errors.append(f"Shadow DOM failed: {e}")

        # Stage 5: JS .click() on main document
        if selector:
            try:
                js_sel = selector.replace("'", "\\'")
                clicked = await self.page.evaluate(
                    f"(()=>{{ var el=document.querySelector('{js_sel}');"
                    "if(!el)return false; el.click(); return true; }})()"
                )
                if clicked:
                    return f"Clicked via JavaScript: {selector}"
                errors.append("JS click: element not found in DOM")
            except Exception as e:
                errors.append(f"JS click failed: {e}")

        return f"Click failed after all fallbacks. Errors: {' | '.join(errors)}"

    # ── Type (iframe-aware, human-like cadence) ───────────────────────────────

    async def type(
        self,
        selector: str,
        text: str,
        clear: bool = True,
        human_like: bool = False
    ) -> str:
        """
        Type text into an input field.
        human_like=True simulates realistic inter-key delays (15-80 ms)
        with occasional brief pauses, to evade keystroke-timing detectors.
        """
        root = self._locator_root()

        if clear:
            try:
                await root.locator(selector).first.fill(text)
                return f"Typed '{text}' into {selector}"
            except Exception:
                # Fallback to page-level fill if frame locator fails
                await self.page.fill(selector, text)
                return f"Typed '{text}' into {selector} (page-level fallback)"

        if human_like:
            await self._human_type(selector, text)
            return f"Human-typed '{text}' into {selector}"

        await self.page.type(selector, text)
        return f"Typed '{text}' into {selector}"

    async def _human_type(self, selector: str, text: str) -> None:
        """Type character-by-character with randomised delays (15–80 ms)."""
        await self.page.click(selector)
        for char in text:
            await self.page.keyboard.type(char)
            delay = random.uniform(0.015, 0.08)
            # Occasional longer pause simulating a brief hesitation
            if random.random() < 0.05:
                delay += random.uniform(0.1, 0.4)
            await asyncio.sleep(delay)

    # ── Human-like bezier mouse movement ─────────────────────────────────────

    async def human_move_to(self, x: int, y: int, steps: int = 20) -> None:
        """
        Move the mouse from current position to (x, y) along a bezier curve
        with random control points, mimicking natural hand motion.
        """
        # Get current mouse position via CDP (approximate with centre if unknown)
        try:
            pos = await self.page.evaluate(
                "() => ({ x: window.__mouseX || 640, y: window.__mouseY || 400 })"
            )
            x0, y0 = pos["x"], pos["y"]
        except Exception:
            x0, y0 = 640, 400

        # Random bezier control points with slight human variance
        cx1 = x0 + random.randint(-120, 120)
        cy1 = y0 + random.randint(-80, 80)
        cx2 = x  + random.randint(-120, 120)
        cy2 = y  + random.randint(-80, 80)

        for i in range(1, steps + 1):
            t = i / steps
            # Cubic bezier interpolation
            bx = ((1-t)**3*x0 + 3*(1-t)**2*t*cx1 + 3*(1-t)*t**2*cx2 + t**3*x)
            by = ((1-t)**3*y0 + 3*(1-t)**2*t*cy1 + 3*(1-t)*t**2*cy2 + t**3*y)
            await self.page.mouse.move(int(bx), int(by))
            await asyncio.sleep(random.uniform(0.005, 0.018))

        # Track position in page JS for future calls
        await self.page.evaluate(
            f"() => {{ window.__mouseX = {x}; window.__mouseY = {y}; }}"
        )

    # ── Shadow DOM query ──────────────────────────────────────────────────────

    async def query_shadow(self, selector: str) -> Optional[str]:
        """
        Search for a CSS selector across all open Shadow DOM roots recursively.
        Returns the element's outerHTML if found, None otherwise.
        Uses a JS helper that pierces open shadow roots.
        """
        script = f"""
        (function() {{
            function queryShadow(root, sel) {{
                const direct = root.querySelector(sel);
                if (direct) return direct.outerHTML;
                const all = root.querySelectorAll('*');
                for (const el of all) {{
                    if (el.shadowRoot) {{
                        const found = queryShadow(el.shadowRoot, sel);
                        if (found) return found;
                    }}
                }}
                return null;
            }}
            return queryShadow(document, '{selector.replace(chr(39), chr(92)+chr(39))}');
        }})()
        """
        try:
            result = await self.page.evaluate(script)
            return result  # outerHTML string or None
        except Exception as e:
            return None

    async def click_shadow(self, selector: str) -> str:
        """Click an element that may be inside a Shadow DOM."""
        script = f"""
        (function() {{
            function queryShadow(root, sel) {{
                const direct = root.querySelector(sel);
                if (direct) return direct;
                const all = root.querySelectorAll('*');
                for (const el of all) {{
                    if (el.shadowRoot) {{
                        const found = queryShadow(el.shadowRoot, sel);
                        if (found) return found;
                    }}
                }}
                return null;
            }}
            const el = queryShadow(document, '{selector.replace(chr(39), chr(92)+chr(39))}');
            if (el) {{ el.click(); return true; }}
            return false;
        }})()
        """
        try:
            clicked = await self.page.evaluate(script)
            if clicked:
                return f"Clicked shadow element: {selector}"
            return f"Shadow element not found: {selector}"
        except Exception as e:
            return f"click_shadow error: {e}"

    # ── get_text (iframe-aware) ───────────────────────────────────────────────

    async def get_text(self, selector: Optional[str] = None) -> str:
        """Get text content from page or element (iframe-aware)."""
        root = self._locator_root()
        if selector:
            try:
                return await root.locator(selector).first.inner_text(timeout=5000)
            except Exception:
                # Fallback: try the full page
                element = await self.page.query_selector(selector)
                if element:
                    return await element.text_content() or ""
                return f"Element not found: {selector}"
        # Full page text
        body = await self.page.query_selector("body")
        if body:
            return await body.text_content() or ""
        return ""

    # ── evaluate (iframe-aware) ───────────────────────────────────────────────

    async def evaluate(self, javascript: str) -> Any:
        """
        Execute JavaScript. Routes to the active frame when inside one,
        otherwise runs on the top-level page.
        """
        if self._active_frame:
            # FrameLocator doesn't expose evaluate directly; go through Frame
            frame = await self._resolve_frame()
            if frame:
                return await frame.evaluate(javascript)
        return await self.page.evaluate(javascript)

    async def _resolve_frame(self) -> Optional[Frame]:
        """Resolve FrameLocator → concrete Frame for evaluate() access."""
        if not self._active_frame_selector:
            return None
        for frame in self.page.frames:
            el = await self.page.query_selector(self._active_frame_selector)
            if el:
                frame_el = await el.content_frame()
                return frame_el
        return None

    # ── wait_for_selector (iframe-aware) ─────────────────────────────────────

    async def wait_for_selector(self, selector: str, timeout: int = 5000) -> bool:
        """Wait for element to appear (iframe-aware)."""
        root = self._locator_root()
        try:
            await root.locator(selector).first.wait_for(timeout=timeout)
            return True
        except Exception:
            return False

    # ── Page info ─────────────────────────────────────────────────────────────

    async def get_page_info(self) -> Tuple[str, str, str]:
        """Get current page URL, title, and visible text."""
        if not self.page:
            return "", "", ""
        url   = self.page.url
        title = await self.page.title()
        content = await self.get_text()
        return url, title, content

    # ── Screenshot ────────────────────────────────────────────────────────────

    async def screenshot(self, full_page: bool = False) -> str:
        """Take screenshot and return base64 encoded."""
        if not self.page:
            return ""
        screenshot_bytes = await self.page.screenshot(full_page=full_page)
        return base64.b64encode(screenshot_bytes).decode()

    # ── Scroll ────────────────────────────────────────────────────────────────

    async def scroll(self, direction: str = "down", amount: int = 3) -> str:
        """Scroll the page."""
        px = 300 * amount
        axes = {
            "down":  f"window.scrollBy(0, {px})",
            "up":    f"window.scrollBy(0, -{px})",
            "right": f"window.scrollBy({px}, 0)",
            "left":  f"window.scrollBy(-{px}, 0)",
        }
        await self.page.evaluate(axes.get(direction, f"window.scrollBy(0, {px})"))
        return f"Scrolled {direction} by {px}px"

    # ── Links ─────────────────────────────────────────────────────────────────

    async def extract_links(self) -> List[Dict[str, str]]:
        """Extract all links from the page."""
        links = await self.page.eval_on_selector_all("a", """
            elements => elements.map(el => ({
                text: el.textContent?.trim() || '',
                href: el.href || '',
                title: el.title || ''
            })).filter(link => link.href)
        """)
        return links

    # ── DOM ───────────────────────────────────────────────────────────────────

    async def get_dom(self) -> str:
        """Get page DOM as HTML."""
        return await self.page.content()

    # ── Keyboard ──────────────────────────────────────────────────────────────

    async def press_key(self, key: str) -> str:
        """Press a keyboard key."""
        await self.page.keyboard.press(key)
        return f"Pressed key: {key}"

    # ── Select ────────────────────────────────────────────────────────────────

    async def select_option(self, selector: str, value: str) -> str:
        """Select option in dropdown."""
        await self.page.select_option(selector, value)
        return f"Selected {value} in {selector}"

    # ── Navigation history ────────────────────────────────────────────────────

    async def go_back(self) -> str:
        """Go back in browser history."""
        await self.page.go_back()
        return "Navigated back"

    async def reload(self) -> str:
        """Reload the page."""
        await self.page.reload()
        return "Page reloaded"

    # ── CDP ───────────────────────────────────────────────────────────────────

    async def get_cdp_session(self):
        """Get CDP session for advanced browser control."""
        return self.cdp_session

    # ── Viewport ──────────────────────────────────────────────────────────────

    async def set_viewport(self, width: int, height: int):
        """Change viewport size."""
        await self.page.set_viewport_size({"width": width, "height": height})
        self.viewport = {"width": width, "height": height}

    # ── Right-click ───────────────────────────────────────────────────────────

    async def right_click(
        self,
        selector: Optional[str] = None,
        coordinates: Optional[Tuple[int, int]] = None
    ) -> str:
        """Right-click to open context menus."""
        if coordinates:
            await self.page.mouse.click(coordinates[0], coordinates[1], button="right")
            return f"Right-clicked at ({coordinates[0]}, {coordinates[1]})"
        if selector:
            await self._locator_root().locator(selector).first.click(button="right", timeout=5000)
            return f"Right-clicked: {selector}"
        return "No right-click target specified"

    # ── Drag-and-drop ─────────────────────────────────────────────────────────

    async def drag_drop(self, source_selector: str, target_selector: str) -> str:
        """Drag element from source to target."""
        source = await self.page.query_selector(source_selector)
        target = await self.page.query_selector(target_selector)
        if not source or not target:
            return "drag_drop: could not find source or target element"
        await source.drag_to(target)
        return f"Dragged '{source_selector}' to '{target_selector}'"

    # ── iframe routing ────────────────────────────────────────────────────────

    async def switch_to_frame(self, selector: str) -> str:
        """
        Switch ALL subsequent interactions (click, type, get_text, evaluate,
        wait_for_selector) into the iframe matched by 'selector'.
        Call switch_to_main_frame() to exit.
        """
        self._active_frame = self.page.frame_locator(selector)
        self._active_frame_selector = selector
        return f"Switched into frame: {selector}"

    async def switch_to_main_frame(self) -> str:
        """Return to the main page context after working inside a frame."""
        self._active_frame = None
        self._active_frame_selector = None
        return "Switched back to main frame"

    async def get_all_frames(self) -> str:
        """List all frames in the current page."""
        frames = self.page.frames
        info = [{"name": f.name, "url": f.url} for f in frames]
        return json.dumps(info, indent=2)

    # ── Visual-Spatial Element Mapping (Skyvern Method) ───────────────────────

    async def tag_interactive_elements(self) -> Dict[int, Dict]:
        """
        Injects a script to draw numbered bounding boxes over all interactive elements.
        Returns a mapping of ID -> Element Info.
        """
        if not self.page:
            return {}
            
        script = """
        (() => {
            let counter = 1;
            const elementsMap = {};
            
            // Clean up any existing tags first
            document.querySelectorAll('.bron-visual-tag').forEach(el => el.remove());

            const interactableSelectors = [
                'a', 'button', 'input', 'select', 'textarea', 
                '[role="button"]', '[role="link"]', '[role="checkbox"]', 
                '[role="menuitem"]', '[role="option"]', '[tabindex]'
            ].join(',');

            function isVisible(el) {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && 
                       style.visibility !== 'hidden' && style.display !== 'none' &&
                       style.opacity !== '0';
            }

            function getElementPath(el) {
                if (!el || el.nodeType !== 1) return '';
                if (el.id) return '#' + el.id;
                let path = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') {
                    // Quick fallback to avoid overly complex class selectors breaking
                    const classes = el.className.trim().split(/\\s+/);
                    if (classes.length > 0 && classes[0] !== '') {
                        path += '.' + classes[0];
                    }
                }
                return path;
            }

            const elements = document.querySelectorAll(interactableSelectors);
            
            elements.forEach(el => {
                if (!isVisible(el)) return;
                
                const rect = el.getBoundingClientRect();
                
                // Ensure element is somewhat within viewport (with a margin for slight overflow)
                if (rect.top > window.innerHeight + 100 || rect.bottom < -100 || 
                    rect.left > window.innerWidth + 100 || rect.right < -100) {
                    return;
                }

                const id = counter++;
                const cx = Math.floor(rect.left + rect.width / 2);
                const cy = Math.floor(rect.top + rect.height / 2);
                
                // Create tag
                const tag = document.createElement('div');
                tag.className = 'bron-visual-tag';
                tag.innerText = id;
                tag.style.position = 'absolute';
                // Account for scroll
                tag.style.top = (rect.top + window.scrollY) + 'px';
                tag.style.left = (rect.left + window.scrollX) + 'px';
                tag.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
                tag.style.color = 'white';
                tag.style.fontSize = '12px';
                tag.style.fontWeight = 'bold';
                tag.style.padding = '2px 4px';
                tag.style.borderRadius = '3px';
                tag.style.zIndex = '2147483647'; // Max z-index
                tag.style.pointerEvents = 'none'; // CRITICAL: don't block clicks
                tag.style.border = '1px solid black';
                tag.style.boxShadow = '0 0 2px black';
                
                document.body.appendChild(tag);
                
                // Extract inner text or value
                let textContent = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '';
                if (textContent.length > 50) textContent = textContent.substring(0, 50) + '...';
                
                elementsMap[id] = {
                    id: id,
                    selector: getElementPath(el),
                    center_x: cx,
                    center_y: cy,
                    type: el.tagName.toLowerCase(),
                    text: textContent.trim().replace(/\\n/g, ' ')
                };
            });
            
            return elementsMap;
        })();
        """
        
        try:
            self.element_map = await self.page.evaluate(script)
            return self.element_map
        except Exception as e:
            return {}

    async def clear_visual_tags(self) -> None:
        """Removes the visual tags from the page."""
        if not self.page:
            return
        
        script = "document.querySelectorAll('.bron-visual-tag').forEach(el => el.remove());"
        try:
            await self.page.evaluate(script)
        except Exception:
            pass

