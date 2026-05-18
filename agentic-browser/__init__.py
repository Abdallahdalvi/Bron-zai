"""
Agentic Browser - A simple Chromium-based agentic browser

Usage:
    from agent import AgenticAgent
    
    agent = AgenticAgent(
        task="Go to example.com and get the heading",
        llm_provider="openai",
        llm_api_key="your-key"
    )
    result = await agent.run()
"""

__version__ = "1.0.0"
__author__ = "Agentic Browser"

from .agent import AgenticAgent
from .browser import AgenticBrowser
from .tools import ToolRegistry

__all__ = ["AgenticAgent", "AgenticBrowser", "ToolRegistry"]
