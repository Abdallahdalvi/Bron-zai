#!/usr/bin/env python3
"""
Setup verification script
"""
import sys
import subprocess
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

console = Console()


def check_python_version():
    """Check Python version"""
    version = sys.version_info
    ok = version.major >= 3 and version.minor >= 11
    return ok, f"{version.major}.{version.minor}.{version.micro}"


def check_package(package_name):
    """Check if a package is installed"""
    try:
        __import__(package_name)
        return True, "Installed"
    except ImportError:
        return False, "Not installed"


def check_env_file():
    """Check if .env file exists with API keys"""
    try:
        with open(".env", "r") as f:
            content = f.read()
            has_openai = "OPENAI_API_KEY" in content and "=" in content
            has_anthropic = "ANTHROPIC_API_KEY" in content and "=" in content
            if has_openai or has_anthropic:
                return True, "Found"
            return False, "API keys not set"
    except FileNotFoundError:
        return False, "Not found"


def check_playwright_browsers():
    """Check if Playwright browsers are installed"""
    try:
        result = subprocess.run(
            ["playwright", "chromium", "--version"],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, "Not installed"
    except Exception as e:
        return False, f"Error: {e}"


def main():
    """Run all checks"""
    console.print(Panel.fit(
        "[bold blue]🌐 Agentic Browser - Setup Check[/bold blue]",
        border_style="blue"
    ))
    
    table = Table(title="Setup Status")
    table.add_column("Component", style="cyan")
    table.add_column("Status", style="green")
    table.add_column("Details", style="dim")
    
    # Python version
    ok, details = check_python_version()
    status = "[green]✓[/green]" if ok else "[red]✗[/red]"
    table.add_row("Python Version", status, details + (" (3.11+ required)" if not ok else ""))
    
    # Required packages
    packages = [
        ("playwright", "playwright"),
        ("rich", "rich"),
        ("pydantic", "pydantic"),
        ("httpx", "httpx"),
        ("pillow", "PIL"),
    ]
    
    for name, import_name in packages:
        ok, details = check_package(import_name)
        status = "[green]✓[/green]" if ok else "[red]✗[/red]"
        table.add_row(f"Package: {name}", status, details)
    
    # .env file
    ok, details = check_env_file()
    status = "[green]✓[/green]" if ok else "[red]✗[/red]"
    table.add_row("Environment (.env)", status, details)
    
    # Playwright browsers
    ok, details = check_playwright_browsers()
    status = "[green]✓[/green]" if ok else "[red]✗[/red]"
    table.add_row("Playwright Chromium", status, details)
    
    console.print(table)
    
    # Recommendations
    console.print("\n[bold]Next Steps:[/bold]")
    
    if not check_python_version()[0]:
        console.print("[red]• Upgrade to Python 3.11 or higher[/red]")
    
    if any(not check_package(p[1])[0] for p in packages):
        console.print("[yellow]• Install dependencies: pip install -r requirements.txt[/yellow]")
    
    if not check_env_file()[0]:
        console.print("[yellow]• Create .env file: cp .env.example .env[/yellow]")
        console.print("[yellow]• Add your API keys to .env[/yellow]")
    
    if not check_playwright_browsers()[0]:
        console.print("[yellow]• Install Playwright browsers: playwright install chromium[/yellow]")
    
    if all([
        check_python_version()[0],
        all(check_package(p[1])[0] for p in packages),
        check_env_file()[0],
        check_playwright_browsers()[0]
    ]):
        console.print("\n[green bold]✓ Ready to run! Try: python main.py[/green bold]")
    else:
        console.print("\n[yellow]⚠ Setup incomplete. Please fix the issues above.[/yellow]")


if __name__ == "__main__":
    main()
