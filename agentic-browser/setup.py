from setuptools import setup, find_packages

setup(
    name="agentic-browser",
    version="1.0.0",
    description="A simple Chromium-based agentic browser using LLMs",
    packages=find_packages(),
    install_requires=[
        "playwright>=1.40.0",
        "pydantic>=2.0.0",
        "rich>=13.0.0",
        "httpx>=0.25.0",
        "python-dotenv>=1.0.0",
        "pillow>=10.0.0",
        "aiohttp>=3.9.0",
        "openai>=1.0.0",
        "anthropic>=0.18.0",
        "markdownify>=0.11.0",
    ],
    python_requires=">=3.11",
    entry_points={
        "console_scripts": [
            "agentic-browser=main:main",
        ],
    },
)
