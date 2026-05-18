#!/usr/bin/env python3
"""
Agentic Browser V2 - CLI with all features
"""
import asyncio
import os
import sys
import argparse
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown
from rich.table import Table

# Load environment variables
load_dotenv()

console = Console()


def print_banner():
    """Print startup banner"""
    banner = """
[bold blue]    _                                _           _     _             
   / \\   __ _  ___ _ __   ___ _ __ | |__   __ _| |__ | |__   ___  \
  / _ \\ / _` |/ _ \\ '_ \\ / _ \\ '_ \\| '_ \\ / _` | '_ \\| '_ \\ / _ \\ 
 / ___ \\ (_| |  __/ | | |  __/ | | | |_) | (_| | |_) | |_) |  __/ 
/_/   \\_\\__, |\\___|_| |_|\\___|_| |_|_.__/ \\__,_|_.__/|_.__/ \\___| 
        |___/                                                      [/bold blue]
                        [dim]V2 - Vision • Memory • Multi-Tab • Auto-Retry[/dim]
    """
    console.print(banner)


async def run_interactive():
    """Interactive mode with all features"""
    print_banner()
    
    # Check API keys
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    
    if not openai_key and not anthropic_key:
        console.print("[red]✗ Error: No API key found![/red]")
        console.print("Set OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file")
        return
    
    # Choose provider
    provider = "openai" if openai_key else "anthropic"
    api_key = openai_key or anthropic_key
    
    console.print(f"[green]✓[/green] Using {provider.upper()} API")
    console.print()
    
    # Feature selection
    console.print("[bold]Configure Features:[/bold]")
    
    use_vision = input("Enable vision (screenshot analysis)? [Y/n]: ").strip().lower() != "n"
    use_memory = input("Enable memory (session persistence)? [Y/n]: ").strip().lower() != "n"
    enable_tabs = input("Enable multi-tab support? [Y/n]: ").strip().lower() != "n"
    headless = input("Run in headless mode (no visible browser)? [y/N]: ").strip().lower() == "y"
    
    # Task input
    console.print("\n[bold yellow]Enter your task:[/bold yellow]")
    console.print("[dim]Examples:[/dim]")
    console.print("  - Go to news.ycombinator.com and get the top 3 stories")
    console.print("  - Search for 'Python tutorials' on google.com")
    console.print("  - Fill the contact form on example.com with name John Doe")
    console.print()
    
    task = input("> ").strip()
    
    if not task:
        console.print("[red]No task provided. Exiting.[/red]")
        return
    
    # Import here to avoid slow startup
    from agent_v2 import AgenticAgentV2
    
    # Create agent with all features
    agent = AgenticAgentV2(
        task=task,
        llm_provider=provider,
        llm_api_key=api_key,
        headless=headless,
        use_vision=use_vision,
        use_memory=use_memory,
        enable_multi_tab=enable_tabs,
        max_steps=25
    )
    
    console.print(f"\n[bold cyan]Starting agent...[/bold cyan]")
    console.print("-" * 60)
    
    try:
        result = await agent.run()
        
        console.print("-" * 60)
        console.print(Panel(result, title="[bold green]Result[/bold green]", border_style="green"))
        
        # Show session report if memory enabled
        if use_memory:
            console.print("\n[yellow]Generate session report? [y/N]:[/yellow]")
            if input("> ").strip().lower() == "y":
                report = agent.get_session_report()
                console.print(Markdown(report))
        
    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()


async def run_single_task(
    task: str,
    provider: str = "openai",
    **kwargs
):
    """Run a single task"""
    api_key = os.getenv(f"{provider.upper()}_API_KEY")
    
    if not api_key:
        console.print(f"[red]✗ {provider.upper()}_API_KEY not found[/red]")
        sys.exit(1)
    
    from agent_v2 import AgenticAgentV2
    
    agent = AgenticAgentV2(
        task=task,
        llm_provider=provider,
        llm_api_key=api_key,
        **kwargs
    )
    
    result = await agent.run()
    console.print(Panel(result, border_style="green"))


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Agentic Browser V2 - Advanced web automation with AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Advanced Examples:
  # Full-featured interactive mode
  %(prog)s
  
  # Vision-enabled task
  %(prog)s -t "Find the red button on example.com" --vision
  
  # Multi-site comparison
  %(prog)s -t "Compare prices on site1.com and site2.com" --multi-tab
  
  # Headless with memory
  %(prog)s -t "Check my email" --headless --memory
  
  # All features enabled
  %(prog)s -t "Research topic X" --vision --memory --multi-tab

Environment Variables:
  OPENAI_API_KEY      OpenAI API key
  ANTHROPIC_API_KEY   Anthropic API key
  AGENT_MEMORY_DIR    Custom memory directory (default: agent_memory)
        """
    )
    
    parser.add_argument("-t", "--task", help="Task to execute")
    parser.add_argument("-p", "--provider", choices=["openai", "anthropic"], default="openai")
    
    # Feature flags
    parser.add_argument("--vision", action="store_true", help="Enable screenshot analysis")
    parser.add_argument("--memory", action="store_true", help="Enable persistent memory")
    parser.add_argument("--multi-tab", action="store_true", help="Enable multi-tab support")
    parser.add_argument("--headless", action="store_true", help="Run browser in background")
    
    # Other options
    parser.add_argument("--max-steps", type=int, default=25, help="Maximum steps (default: 25)")
    parser.add_argument("--viewport", default="1280x800", help="Viewport size (default: 1280x800)")
    parser.add_argument("--report", action="store_true", help="Export session report after completion")
    
    args = parser.parse_args()
    
    try:
        if args.task:
            # Parse viewport
            width, height = map(int, args.viewport.split('x'))
            
            asyncio.run(run_single_task(
                task=args.task,
                provider=args.provider,
                headless=args.headless,
                use_vision=args.vision,
                use_memory=args.memory,
                enable_multi_tab=args.multi_tab,
                max_steps=args.max_steps,
                viewport={"width": width, "height": height}
            ))
        else:
            asyncio.run(run_interactive())
            
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
        sys.exit(0)


if __name__ == "__main__":
    main()
