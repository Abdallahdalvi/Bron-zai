#!/usr/bin/env python3
"""
Simple Demo - Basic agentic browser usage
"""
import asyncio
import os
from dotenv import load_dotenv

# Add parent directory to path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent import AgenticAgent
from rich.console import Console

console = Console()


async def demo_basic_navigation():
    """Demo 1: Basic navigation and text extraction"""
    console.print("\n[bold cyan]Demo 1: Basic Navigation[/bold cyan]")
    console.print("=" * 50)
    
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    provider = "openai" if os.getenv("OPENAI_API_KEY") else "anthropic"
    
    agent = AgenticAgent(
        task="Go to https://example.com and tell me what the main heading says",
        llm_provider=provider,
        llm_api_key=api_key,
        headless=False
    )
    
    result = await agent.run()
    console.print(f"\n[green]Result:[/green] {result}")


async def demo_multi_step():
    """Demo 2: Multi-step task"""
    console.print("\n[bold cyan]Demo 2: Multi-Step Task[/bold cyan]")
    console.print("=" * 50)
    
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    provider = "openai" if os.getenv("OPENAI_API_KEY") else "anthropic"
    
    agent = AgenticAgent(
        task="Go to https://httpbin.org/forms/post, fill the form with customer name 'John Doe' and comments 'Test comment', then submit it",
        llm_provider=provider,
        llm_api_key=api_key,
        headless=False
    )
    
    result = await agent.run()
    console.print(f"\n[green]Result:[/green] {result}")


async def demo_with_custom_tools():
    """Demo 3: Using custom tools"""
    console.print("\n[bold cyan]Demo 3: Custom Tools[/bold cyan]")
    console.print("=" * 50)
    
    from tools import ToolRegistry
    
    # Create custom tool registry
    class MyTools(ToolRegistry):
        pass
    
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    provider = "openai" if os.getenv("OPENAI_API_KEY") else "anthropic"
    
    agent = AgenticAgent(
        task="Go to https://example.com and extract all links",
        llm_provider=provider,
        llm_api_key=api_key,
        headless=False
    )
    
    result = await agent.run()
    console.print(f"\n[green]Result:[/green] {result}")


def print_usage():
    """Print usage instructions"""
    console.print("""
[bold]Usage:[/bold]
    python simple_demo.py [demo_number]

[bold]Demos:[/bold]
    1 - Basic navigation and text extraction
    2 - Multi-step form filling
    3 - Using custom tools

[bold]Examples:[/bold]
    python simple_demo.py 1
    python simple_demo.py 2

[bold]Requirements:[/bold]
    - Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env file
    - Run: pip install -r requirements.txt
    - Run: playwright install chromium
""")


async def main():
    """Main entry point"""
    load_dotenv()
    
    if len(sys.argv) < 2:
        print_usage()
        return
    
    demo_number = sys.argv[1]
    
    # Map demo numbers to functions
    demos = {
        "1": demo_basic_navigation,
        "2": demo_multi_step,
        "3": demo_with_custom_tools,
    }
    
    if demo_number not in demos:
        console.print(f"[red]Unknown demo: {demo_number}[/red]")
        print_usage()
        return
    
    # Check API key
    if not os.getenv("OPENAI_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        console.print("[red]Error: No API key found![/red]")
        console.print("Please create a .env file with OPENAI_API_KEY or ANTHROPIC_API_KEY")
        return
    
    try:
        await demos[demo_number]()
    except KeyboardInterrupt:
        console.print("\n[yellow]Demo interrupted by user[/yellow]")
    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
