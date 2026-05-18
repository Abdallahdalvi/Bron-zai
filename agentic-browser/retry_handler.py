"""
Retry & Error Recovery Module
Built-in retry logic with exponential backoff and intelligent error recovery
"""
import asyncio
import random
from typing import Callable, Any, Optional, Type, List, Dict
from dataclasses import dataclass
from enum import Enum
from functools import wraps
from rich.console import Console

console = Console()


class ErrorType(Enum):
    """Types of errors for different recovery strategies"""
    NETWORK = "network"          # Connection issues, timeouts
    ELEMENT = "element"          # Element not found, stale element
    NAVIGATION = "navigation"    # 404, redirects, page load failures
    RATE_LIMIT = "rate_limit"    # API rate limiting
    UNKNOWN = "unknown"          # Everything else


@dataclass
class RetryConfig:
    """Configuration for retry behavior"""
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 30.0
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_exceptions: List[Type[Exception]] = None
    
    def __post_init__(self):
        if self.retryable_exceptions is None:
            self.retryable_exceptions = [
                ConnectionError,
                TimeoutError,
                asyncio.TimeoutError,
                Exception  # Catch-all for generic retries
            ]


@dataclass
class RecoveryStrategy:
    """Strategy for recovering from specific errors"""
    error_type: ErrorType
    recovery_actions: List[Callable]
    description: str


class RetryHandler:
    """
    Intelligent retry handler with error classification and recovery
    """
    
    def __init__(self, config: Optional[RetryConfig] = None):
        self.config = config or RetryConfig()
        self.recovery_strategies: Dict[ErrorType, RecoveryStrategy] = {}
        self._setup_default_strategies()
        
    def _setup_default_strategies(self):
        """Setup default recovery strategies"""
        
        self.recovery_strategies[ErrorType.NETWORK] = RecoveryStrategy(
            error_type=ErrorType.NETWORK,
            description="Network connectivity issues",
            recovery_actions=[
                self._action_wait,
                self._action_refresh_page,
                self._action_restart_browser
            ]
        )
        
        self.recovery_strategies[ErrorType.ELEMENT] = RecoveryStrategy(
            error_type=ErrorType.ELEMENT,
            description="Element interaction failures",
            recovery_actions=[
                self._action_scroll_to_element,
                self._action_wait_for_load,
                self._action_refresh_page
            ]
        )
        
        self.recovery_strategies[ErrorType.NAVIGATION] = RecoveryStrategy(
            error_type=ErrorType.NAVIGATION,
            description="Navigation and page load failures",
            recovery_actions=[
                self._action_go_back,
                self._action_retry_navigation,
                self._action_use_fallback_url
            ]
        )
        
        self.recovery_strategies[ErrorType.RATE_LIMIT] = RecoveryStrategy(
            error_type=ErrorType.RATE_LIMIT,
            description="API rate limiting",
            recovery_actions=[
                self._action_long_wait,
                self._action_switch_proxy,
                self._action_backoff_exponentially
            ]
        )
    
    def classify_error(self, error: Exception, context: dict = None) -> ErrorType:
        """Classify an error into a type"""
        error_str = str(error).lower()
        error_type = type(error).__name__.lower()
        
        # Network errors
        if any(kw in error_str for kw in ["connection", "timeout", "refused", "network", "dns"]):
            return ErrorType.NETWORK
        
        # Element errors
        if any(kw in error_str for kw in ["element", "selector", "not found", "stale", "detached"]):
            return ErrorType.ELEMENT
        
        # Navigation errors
        if any(kw in error_str for kw in ["404", "403", "500", "redirect", "navigation", "load"]):
            return ErrorType.NAVIGATION
        
        # Rate limit
        if any(kw in error_str for kw in ["rate limit", "too many requests", "429", "throttle"]):
            return ErrorType.RATE_LIMIT
        
        return ErrorType.UNKNOWN
    
    async def execute_with_retry(
        self,
        func: Callable,
        *args,
        context: dict = None,
        on_retry: Optional[Callable] = None,
        **kwargs
    ) -> Any:
        """
        Execute a function with retry logic
        
        Args:
            func: Async function to execute
            *args: Arguments for func
            context: Additional context for error classification
            on_retry: Callback function called on each retry
            **kwargs: Keyword arguments for func
        
        Returns:
            Result of func
        
        Raises:
            Exception if all retries fail
        """
        last_error = None
        
        for attempt in range(self.config.max_retries + 1):
            try:
                return await func(*args, **kwargs)
                
            except Exception as e:
                last_error = e
                
                # Check if this exception type is retryable
                if not any(isinstance(e, exc_type) for exc_type in self.config.retryable_exceptions):
                    raise  # Not retryable, raise immediately
                
                # Don't retry on last attempt
                if attempt == self.config.max_retries:
                    break
                
                # Classify error
                error_type = self.classify_error(e, context)
                
                # Calculate delay
                delay = self._calculate_delay(attempt)
                
                console.print(f"[yellow]⚠ Attempt {attempt + 1} failed: {e}[/yellow]")
                console.print(f"[yellow]  Error type: {error_type.value}[/yellow]")
                console.print(f"[yellow]  Retrying in {delay:.1f}s...[/yellow]")
                
                # Try recovery action
                strategy = self.recovery_strategies.get(error_type)
                if strategy and attempt < len(strategy.recovery_actions):
                    recovery_action = strategy.recovery_actions[attempt]
                    try:
                        await recovery_action(context)
                    except Exception as recovery_error:
                        console.print(f"[dim]Recovery action failed: {recovery_error}[/dim]")
                
                # Call callback if provided
                if on_retry:
                    on_retry(attempt, e, error_type)
                
                # Wait before retry
                await asyncio.sleep(delay)
        
        # All retries exhausted
�        console.print(f"[red]✗ All {self.config.max_retries} retries failed[/red]")
        raise last_error
    
    def _calculate_delay(self, attempt: int) -> float:
        """Calculate delay with exponential backoff and jitter"""
        delay = self.config.base_delay * (self.config.exponential_base ** attempt)
        delay = min(delay, self.config.max_delay)
        
        if self.config.jitter:
            # Add random jitter (±25%)
            jitter = delay * 0.25
            delay = delay + random.uniform(-jitter, jitter)
        
        return max(0.1, delay)  # Minimum 100ms delay
    
    # Recovery Actions
    
    async def _action_wait(self, context):
        """Simple wait"""
        await asyncio.sleep(2)
    
    async def _action_long_wait(self, context):
        """Longer wait for rate limits"""
        await asyncio.sleep(10)
    
    async def _action_refresh_page(self, context):
        """Refresh the current page"""
        if context and "browser" in context:
            await context["browser"].reload()
    
    async def _action_scroll_to_element(self, context):
        """Scroll to make element visible"""
        if context and "browser" in context:
            await context["browser"].scroll("down", 3)
    
    async def _action_wait_for_load(self, context):
        """Wait for page to fully load"""
        await asyncio.sleep(3)
    
    async def _action_go_back(self, context):
        """Go back to previous page"""
        if context and "browser" in context:
            await context["browser"].go_back()
    
    async def _action_retry_navigation(self, context):
        """Retry navigation to same URL"""
        if context and "browser" in context and "url" in context:
            await context["browser"].navigate(context["url"])
    
    async def _action_use_fallback_url(self, context):
        """Try alternative URL if available"""
        if context and "fallback_url" in context:
            await context["browser"].navigate(context["fallback_url"])
    
    async def _action_switch_proxy(self, context):
        """Switch to different proxy"""
        # Placeholder for proxy rotation
        console.print("[dim]Would switch proxy here[/dim]")
        await asyncio.sleep(5)
    
    async def _action_restart_browser(self, context):
        """Restart browser as last resort"""
        if context and "browser" in context:
            browser = context["browser"]
            await browser.close()
            await browser.start()
    
    async def _action_backoff_exponentially(self, context):
        """Exponential backoff already handled in delay calculation"""
        pass


class CircuitBreaker:
    """
    Circuit breaker pattern to prevent cascading failures
    """
    
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 3
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        
        self.failures = 0
        self.last_failure_time: Optional[float] = None
        self.state = "closed"  # closed, open, half-open
        self.half_open_calls = 0
        
    async def call(self, func: Callable, *args, **kwargs) -> Any:
        """Call function with circuit breaker protection"""
        
        if self.state == "open":
            # Check if recovery timeout has passed
            if asyncio.get_event_loop().time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half-open"
                self.half_open_calls = 0
                console.print("[yellow]Circuit breaker: Entering half-open state[/yellow]")
            else:
                raise Exception("Circuit breaker is OPEN - service unavailable")
        
        if self.state == "half-open" and self.half_open_calls >= self.half_open_max_calls:
            raise Exception("Circuit breaker: Half-open call limit reached")
        
        try:
            if self.state == "half-open":
                self.half_open_calls += 1
            
            result = await func(*args, **kwargs)
            
            # Success - reset if half-open
            if self.state == "half-open":
                self._reset()
                console.print("[green]Circuit breaker: Service recovered[/green]")
            
            return result
            
        except Exception as e:
            self._record_failure()
            raise e
    
    def _record_failure(self):
        """Record a failure"""
        self.failures += 1
        self.last_failure_time = asyncio.get_event_loop().time()
        
        if self.failures >= self.failure_threshold:
            self.state = "open"
            console.print(f"[red]Circuit breaker: OPEN ({self.failures} failures)[/red]")
    
    def _reset(self):
        """Reset circuit breaker"""
        self.failures = 0
        self.last_failure_time = None
        self.state = "closed"
        self.half_open_calls = 0


def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    retryable_exceptions: Optional[List[Type[Exception]]] = None
):
    """
    Decorator for adding retry logic to functions
    
    Usage:
        @with_retry(max_retries=3)
        async def my_function():
            ...
    """
    config = RetryConfig(
        max_retries=max_retries,
        base_delay=base_delay,
        retryable_exceptions=retryable_exceptions
    )
    handler = RetryHandler(config)
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await handler.execute_with_retry(func, *args, **kwargs)
        return wrapper
    return decorator


class RecoveryContext:
    """
    Context manager for automatic cleanup and recovery
    """
    
    def __init__(self, browser, retry_handler: Optional[RetryHandler] = None):
        self.browser = browser
        self.retry_handler = retry_handler or RetryHandler()
        self.errors: List[Exception] = []
        
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            # Try to recover
            try:
                error_type = self.retry_handler.classify_error(exc_val)
                strategy = self.retry_handler.recovery_strategies.get(error_type)
                
                if strategy and strategy.recovery_actions:
                    console.print(f"[yellow]Attempting recovery from {error_type.value}...[/yellow]")
                    for action in strategy.recovery_actions[:2]:  # Try first 2
                        try:
                            await action({"browser": self.browser})
                            console.print("[green]Recovery successful[/green]")
                            return True  # Suppress exception
                        except:
                            continue
            except:
                pass
        
        return False  # Don't suppress exception
    
    async def safe_execute(
        self,
        func: Callable,
        *args,
        fallback: Optional[Any] = None,
        **kwargs
    ) -> Any:
        """Execute with automatic recovery"""
        try:
            return await self.retry_handler.execute_with_retry(
                func, *args, context={"browser": self.browser}, **kwargs
            )
        except Exception as e:
            self.errors.append(e)
            console.print(f"[red]Execution failed after retries: {e}[/red]")
            return fallback
