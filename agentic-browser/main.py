#!/usr/bin/env python3
"""
Agentic Browser - Simple CLI Entry Point
"""
import asyncio
import os
import sys
import argparse
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown

# Load environment variables
load_dotenv()

console = Console()


async def run_interactive():
    """Run in interactive mode"""
    console.print(Panel.fit(
        "[bold blue]🌐 Agentic Browser[/bold blue]\n"
        "A simple Chromium-based agentic browser using LLMs",
        border_style="blue"
    ))
    
    # Check API keys
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    
    if not openai_key and not anthropic_key:
        console.print("[red]✗ Error: No API key found![/red]")
        console.print("Please set either OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file")
        return
    
    # Choose provider
    provider = "openai" if openai_key else "anthropic"
    api_key = openai_key or anthropic_key
    
    console.print(f"[green]✓[/green] Using {provider.upper()} API")
    console.print()
    
    # Get task from user
    console.print("[yellow]Enter your task (e.g., 'Go to example.com and find the heading'):[/yellow]")
    task = input("> ").strip()
    
    if not task:
        console.print("[red]No task provided. Exiting.[/red]")
        return
    
    # Ask for headless mode
    console.print("\n[yellow]Run in headless mode? (background, no visible browser) [y/N]:[/yellow]")
    headless = input("> ").strip().lower() == "y"
    
    # Import and run agent
    from agent import AgenticAgent
    
    console.print(f"\n[bold cyan]Starting agent...[/bold cyan]")
    console.print("-" * 60)
    
    agent = AgenticAgent(
        task=task,
        llm_provider=provider,
        llm_api_key=api_key,
        headless=headless
    )
    
    result = await agent.run()
    
    console.print("-" * 60)
    console.print(Panel(result, title="[bold green]Final Result[/bold green]", border_style="green"))


async def run_single_task(task: str, provider: str = "openai", headless: bool = False):
    """Run a single task and exit"""
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    
    api_key = openai_key if provider == "openai" and openai_key else anthropic_key
    
    if not api_key:
        console.print("[red]✗ No API key found for provider: {provider}[/red]")
        sys.exit(1)
    
    from agent import AgenticAgent
    
    agent = AgenticAgent(
        task=task,
        llm_provider=provider,
        llm_api_key=api_key,
        headless=headless
    )
    
    result = await agent.run()
    console.print(Panel(result, title="[bold green]Result[/bold green]", border_style="green"))


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Agentic Browser - Automate web tasks with AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                          # Interactive mode
  %(prog)s -t "Go to google.com”    # Run single task
  %(prog)s -t "Find latest news on bbc.com” --headless
  %(prog)s --provider anthropic -t "Search for Python tutorials on youtube.com"
        """
    )
    
    parser.add_argument(
        "-t", "--task",
        help="Task to execute (if not provided, starts interactive mode)"
    )
    
    parser.add_argument(
        "-p", "--provider",
        choices=["openai", "anthropic"],
        default="openai",
        help="LLM provider to use (default: openai)"
    )
    
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run browser in headless mode (no visible window)"
    )
    
    parser.add_argument(
        "--version",
        action="version",
        version="Agentic Browser 1.0.0"
    )
    
    args = parser.parse_args()
    
    try:
        if args.task:
            asyncio.run(run_single_task(args.task, args.provider, args.headless))
        else:
            asyncio.run(run_interactive())
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
        sys.exit(0)


if __name__ == "__main__":
    main()
