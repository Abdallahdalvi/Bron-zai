"""
Memory Module - Persistent Storage and Session Management
Enables the agent to remember across sessions and tasks
"""
import json
import os
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from pathlib import Path
from dataclasses import dataclass, asdict
import aiofiles


@dataclass
class Session:
    """A browsing session"""
    id: str
    task: str
    start_time: datetime
    end_time: Optional[datetime] = None
    steps: List[Dict[str, Any]] = None
    final_result: Optional[str] = None
    screenshots: List[str] = None  # Base64 encoded
    urls_visited: List[str] = None
    success: bool = False
    
    def __post_init__(self):
        if self.steps is None:
            self.steps = []
        if self.screenshots is None:
            self.screenshots = []
        if self.urls_visited is None:
            self.urls_visited = []


@dataclass
class Memory:
    """A memory item (fact, preference, learned behavior)"""
    id: str
    content: str
    category: str  # user_preference, site_behavior, task_learned, etc.
    created_at: datetime
    last_accessed: datetime
    access_count: int = 0
    source_task: Optional[str] = None
    confidence: float = 1.0


class MemoryManager:
    """
    Manages persistent memory across sessions
    Stores: session history, learned behaviors, user preferences
    """
    
    def __init__(self, memory_dir: str = "agent_memory"):
        self.memory_dir = Path(memory_dir)
        self.memory_dir.mkdir(exist_ok=True)
        
        self.sessions_dir = self.memory_dir / "sessions"
        self.knowledge_dir = self.memory_dir / "knowledge"
        self.sessions_dir.mkdir(exist_ok=True)
        self.knowledge_dir.mkdir(exist_ok=True)
        
        self.current_session: Optional[Session] = None
        self.memory_cache: Dict[str, Memory] = {}
        
    def start_session(self, task: str) -> Session:
        """Start a new browsing session"""
        session_id = hashlib.md5(f"{task}{datetime.now()}".encode()).hexdigest()[:12]
        self.current_session = Session(
            id=session_id,
            task=task,
            start_time=datetime.now()
        )
        return self.current_session
    
    async def end_session(self, success: bool = False, result: Optional[str] = None):
        """End current session and save it"""
        if not self.current_session:
            return
        
        self.current_session.end_time = datetime.now()
        self.current_session.success = success
        self.current_session.final_result = result
        
        await self._save_session(self.current_session)
        self.current_session = None
    
    async def record_step(
        self,
        action: str,
        action_input: Dict[str, Any],
        observation: str,
        screenshot_b64: Optional[str] = None
    ):
        """Record a step in the current session"""
        if not self.current_session:
            return
        
        step = {
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "input": action_input,
            "observation": observation[:500]  # Truncate for storage
        }
        
        self.current_session.steps.append(step)
        
        if screenshot_b64:
            self.current_session.screenshots.append(screenshot_b64)
    
    async def record_url(self, url: str):
        """Record a visited URL"""
        if self.current_session and url not in self.current_session.urls_visited:
            self.current_session.urls_visited.append(url)
    
    async def add_memory(
        self,
        content: str,
        category: str = "general",
        source_task: Optional[str] = None,
        confidence: float = 1.0
    ) -> Memory:
        """Add a new memory"""
        memory_id = hashlib.md5(content.encode()).hexdigest()[:16]
        now = datetime.now()
        
        memory = Memory(
            id=memory_id,
            content=content,
            category=category,
            created_at=now,
            last_accessed=now,
            source_task=source_task,
            confidence=confidence
        )
        
        self.memory_cache[memory_id] = memory
        await self._save_memory(memory)
        return memory
    
    async def search_memories(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 5
    ) -> List[Memory]:
        """Search memories by content (simple keyword matching)"""
        results = []
        query_lower = query.lower()
        
        # Search in cache first
        for memory in self.memory_cache.values():
            if category and memory.category != category:
                continue
            
            if query_lower in memory.content.lower():
                results.append(memory)
                memory.access_count += 1
                memory.last_accessed = datetime.now()
        
        # Load from disk if cache miss
        if len(results) < limit:
            disk_results = await self._search_disk_memories(query, category, limit - len(results))
            results.extend(disk_results)
        
        # Sort by confidence and recency
        results.sort(key=lambda m: (m.confidence, m.last_accessed), reverse=True)
        return results[:limit]
    
    async def get_learned_patterns(self, site: str) -> List[str]:
        """Get learned patterns for a specific site"""
        memories = await self.search_memories(site, category="site_behavior")
        return [m.content for m in memories]
    
    async def get_session_history(self, days: int = 7) -> List[Session]:
        """Get recent sessions"""
        cutoff = datetime.now() - timedelta(days=days)
        sessions = []
        
        for session_file in self.sessions_dir.glob("*.json"):
            try:
                async with aiofiles.open(session_file, 'r') as f:
                    data = json.loads(await f.read())
                    start_time = datetime.fromisoformat(data['start_time'])
                    if start_time >= cutoff:
                        sessions.append(Session(**data))
            except Exception:
                continue
        
        return sorted(sessions, key=lambda s: s.start_time, reverse=True)
    
    async def get_similar_tasks(self, task: str, limit: int = 3) -> List[Session]:
        """Find previously completed similar tasks"""
        # Simple keyword matching
        task_keywords = set(task.lower().split())
        all_sessions = await self.get_session_history(days=30)
        
        scored_sessions = []
        for session in all_sessions:
            if not session.success:
                continue
            
            session_keywords = set(session.task.lower().split())
            overlap = len(task_keywords & session_keywords)
            score = overlap / max(len(task_keywords), len(session_keywords))
            
            if score > 0.3:  # At least 30% overlap
                scored_sessions.append((score, session))
        
        scored_sessions.sort(reverse=True, key=lambda x: x[0])
        return [s for _, s in scored_sessions[:limit]]
    
    async def _save_session(self, session: Session):
        """Save session to disk"""
        filepath = self.sessions_dir / f"{session.id}.json"
        data = asdict(session)
        data['start_time'] = session.start_time.isoformat()
        data['end_time'] = session.end_time.isoformat() if session.end_time else None
        
        async with aiofiles.open(filepath, 'w') as f:
            await f.write(json.dumps(data, indent=2))
    
    async def _save_memory(self, memory: Memory):
        """Save memory to disk"""
        filepath = self.knowledge_dir / f"{memory.category}_{memory.id}.json"
        data = asdict(memory)
        data['created_at'] = memory.created_at.isoformat()
        data['last_accessed'] = memory.last_accessed.isoformat()
        
        async with aiofiles.open(filepath, 'w') as f:
            await f.write(json.dumps(data, indent=2))
    
    async def _search_disk_memories(
        self,
        query: str,
        category: Optional[str],
        limit: int
    ) -> List[Memory]:
        """Search memories on disk"""
        results = []
        
        pattern = f"{category}_*" if category else "*.json"
        
        for memory_file in self.knowledge_dir.glob(pattern):
            try:
                async with aiofiles.open(memory_file, 'r') as f:
                    data = json.loads(await f.read())
                    if query.lower() in data.get('content', '').lower():
                        data['created_at'] = datetime.fromisoformat(data['created_at'])
                        data['last_accessed'] = datetime.fromisoformat(data['last_accessed'])
                        results.append(Memory(**data))
            except Exception:
                continue
        
        return results[:limit]
    
    def get_context_for_task(self, task: str) -> str:
        """Get relevant context for a new task"""
        context_parts = []
        
        # Get similar successful tasks
        # This is async, so we return a coroutine placeholder
        return f"""
Memory System Active
- Session storage: {self.sessions_dir}
- Knowledge base: {self.knowledge_dir}
- Current session: {self.current_session.id if self.current_session else 'None'}
"""
    
    async def export_session_report(self, session_id: Optional[str] = None) -> str:
        """Export a detailed session report"""
        if session_id and self.current_session and self.current_session.id == session_id:
            session = self.current_session
        elif session_id:
            filepath = self.sessions_dir / f"{session_id}.json"
            if not filepath.exists():
                return "Session not found"
            async with aiofiles.open(filepath, 'r') as f:
                data = json.loads(await f.read())
                session = Session(**data)
        else:
            return "No session specified"
        
        duration = "In progress"
        if session.end_time and session.start_time:
            duration = str(session.end_time - session.start_time)
        
        report = f"""
# Session Report: {session.id}

## Overview
- Task: {session.task}
- Start Time: {session.start_time}
- Duration: {duration}
- Success: {'✓' if session.success else '✗'}
- Steps Taken: {len(session.steps)}
- URLs Visited: {len(session.urls_visited)}

## Result
{session.final_result or 'No result recorded'}

## URLs Visited
{chr(10).join(f"- {url}" for url in session.urls_visited)}

## Step History
"""
        for i, step in enumerate(session.steps, 1):
            report += f"""
### Step {i}
- Action: {step['action']}
- Input: {step['input']}
- Observation: {step['observation'][:200]}...
"""
        
        return report


# Synchronous wrapper for simple cases
class SimpleMemoryManager:
    """Synchronous version for simple use cases"""
    
    def __init__(self, memory_dir: str = "agent_memory"):
        self.manager = MemoryManager(memory_dir)
    
    def start_session(self, task: str) -> Session:
        import asyncio
        return asyncio.run(self.manager.start_session(task))
    
    def add_memory(self, content: str, category: str = "general"):
        import asyncio
        return asyncio.run(self.manager.add_memory(content, category))
