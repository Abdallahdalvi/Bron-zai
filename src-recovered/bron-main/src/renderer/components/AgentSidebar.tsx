import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Square,
  Brain,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Database,
  Paperclip,
  Trash2,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Check,
  FileText,
  Download,
  RotateCcw,
  Copy,
  X,
  MessageSquare,
  Globe,
} from 'lucide-react';
import type { ChatMessage, AgentAttachment, CreditUsageRecord } from '../../shared/types';

interface Props {
  agentRunning: boolean;
  setAgentRunning: (running: boolean) => void;
  onOpenMemory: () => void;
  onOpenHistory: () => void;
  onRefresh: () => void;
}

const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-bron-text">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1.5 py-0.5 bg-bron-surface rounded border border-bron-border text-[11px] font-mono text-bron-accent">{part.slice(1, -1)}</code>;
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a 
              key={i} 
              href={linkMatch[2]} 
              onClick={(e) => {
                e.preventDefault();
                const bridge = (window as any).__bronBridgeExecute;
                if (typeof bridge === 'function') {
                  bridge({ method: 'navigate', payload: { url: linkMatch[2] } }).catch(() => {});
                  return;
                }
                window.bronAPI?.navigate(linkMatch[2]);
              }}
              className="text-bron-accent hover:opacity-80 underline decoration-bron-accent/40 cursor-pointer font-semibold"
            >
              {linkMatch[1]}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
};

const FormattedResult: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;

  const copyTableToClipboard = (tableLines: string[]) => {
    // 1. Generate TSV for simple pasting
    const tsv = tableLines
      .filter(l => !/^\|[\s\-:|]+\|$/.test(l))
      .map(line => {
        return line.split('|')
          .filter((cell, idx, arr) => (idx > 0 && idx < arr.length - 1))
          .map(cell => cell.trim())
          .join('\t');
      }).join('\n');

    // 2. Generate Rich HTML for themed pasting (Google Sheets/Excel)
    const headers = tableLines[0].split('|').slice(1, -1).map(h => h.trim());
    const rows = tableLines.slice(2).filter(l => !/^\|[\s\-:|]+\|$/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));

    const htmlTable = `
      <table style="border-collapse: collapse; font-family: sans-serif; width: 100%;">
        <thead>
          <tr style="background-color: #2a4365; color: white;">
            ${headers.map(h => `<th style="border: 1px solid #ddd; padding: 12px; text-align: left;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, i) => `
            <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              ${row.map(c => `<td style="border: 1px solid #ddd; padding: 10px;">${c}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const blobHtml = new Blob([htmlTable], { type: 'text/html' });
    const blobText = new Blob([tsv], { type: 'text/plain' });
    
    const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
    navigator.clipboard.write(data).then(() => {
      alert('Table copied with formatting! You can now paste into Sheets or Excel.');
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      const startIdx = i;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      elements.push(
        <div key={startIdx} className="group relative">
          <div className="overflow-x-auto my-4 rounded-xl border border-bron-border shadow-lg bg-bron-panel ring-1 ring-bron-border/50 no-scrollbar">
            <table className="w-full text-[12px] border-collapse min-w-[500px] table-fixed">
              <thead>
                <tr className="bg-bron-accent/10 border-b border-bron-border">
                  {tableLines[0].split('|').slice(1, -1).map((cell, j) => (
                    <th key={j} className="px-4 py-3 text-left font-bold text-bron-text uppercase tracking-tight whitespace-nowrap bg-bron-accent/5 sticky top-0 z-10">
                      {cell.trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-bron-border/40">
                {tableLines.slice(2).filter(l => !/^\|[\s\-:|]+\|$/.test(l)).map((l, j) => (
                  <tr key={j} className="hover:bg-bron-surface/30 transition-colors group/row">
                    {l.split('|').slice(1, -1).map((cell, k) => (
                      <td key={k} className="px-4 py-3 align-top text-bron-text-dim leading-relaxed font-medium break-words">
                        <MarkdownText text={cell.trim()} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button 
            onClick={() => copyTableToClipboard(tableLines)}
            className="absolute -top-3 -right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bron-accent text-white text-[10px] font-bold shadow-xl opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0"
          >
            <Copy className="w-3 h-3" />
            COPY FOR SHEETS
          </button>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('###')) {
      elements.push(<h4 key={i} className="font-bold text-bron-text text-[13px] mt-5 mb-2"><MarkdownText text={trimmed.replace(/^#{3,}\s*/, '')} /></h4>);
    } else if (trimmed.startsWith('##')) {
      elements.push(<h3 key={i} className="font-extrabold text-bron-text text-[15px] mt-6 mb-3 border-b border-bron-border pb-1"><MarkdownText text={trimmed.replace(/^#{2}\s*/, '')} /></h3>);
    } else if (trimmed.startsWith('#')) {
      elements.push(<h2 key={i} className="font-extrabold text-bron-text text-[18px] mt-7 mb-4"><MarkdownText text={trimmed.replace(/^#\s*/, '')} /></h2>);
    } else if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(<hr key={i} className="my-4 border-bron-border" />);
    } else if (trimmed.startsWith('>')) {
      elements.push(<div key={i} className="border-l-4 border-bron-accent/40 bg-bron-accent/5 px-4 py-2 my-4 text-[13px] text-bron-text-dim italic rounded-r-lg"><MarkdownText text={trimmed.replace(/^>\s*/, '')} /></div>);
    } else if (trimmed === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-[13.5px] text-bron-text my-1.5 leading-relaxed font-medium"><MarkdownText text={line} /></p>);
    }
    i++;
  }

  return <div className="space-y-1">{elements}</div>;
};

const StepGroups: React.FC<{ steps: ChatMessage[] }> = ({ steps }) => {
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;

  return (
    <div className="animate-fade-in mt-1">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors mb-1 ml-1 font-bold uppercase tracking-wider"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{steps.length} {steps.length === 1 ? 'Step' : 'Steps'}</span>
        {!expanded && <span className="text-bron-text-muted normal-case font-medium ml-1"> - {steps[steps.length - 1].content.slice(0, 60)}...</span>}
      </button>
      {expanded && (
        <div className="space-y-1 ml-2 border-l border-blue-500/20 pl-2">
          {steps.map(step => (
            <div key={step.id} className="px-2.5 py-2 rounded-md text-[11px] font-mono leading-relaxed bg-blue-500/5 border-l-2 border-blue-500/30 text-bron-text-dim">
              {step.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AgentSidebar: React.FC<Props> = ({
  agentRunning,
  setAgentRunning,
  onOpenMemory,
  onOpenHistory,
  onRefresh,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isChatMode, setIsChatMode] = useState(false);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [creditHistory, setCreditHistory] = useState<CreditUsageRecord[]>([]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  const fetchUsage = useCallback(async () => {
    if (!window.bronAPI?.getSettings) return;
    try {
      const settings = await window.bronAPI.getSettings();
      if (settings?.apiKey) {
        const res = await fetch('https://openrouter.ai/api/v1/credits', {
          headers: { 'Authorization': `Bearer ${settings.apiKey}` }
        });
        const data = await res.json();
        if (data?.data?.total_credits !== undefined) {
          const total = Number(data.data.total_credits);
          const usage = Number(data.data.total_usage || 0);
          setUsage(`$${(total - usage).toFixed(2)} remaining`);
        }
      }
    } catch (e) {
      console.error('Failed to fetch usage:', e);
    }
  }, []);

  const fetchCreditHistory = useCallback(async () => {
    if (!window.bronAPI?.getCreditUsageHistory) return;
    try {
      const rows = await window.bronAPI.getCreditUsageHistory(60);
      if (Array.isArray(rows)) {
        // Group by task_id to show per-task totals instead of individual calls
        const groups: Record<number, CreditUsageRecord> = {};
        const orphans: CreditUsageRecord[] = [];
        
        rows.forEach(r => {
          if (r.task_id) {
            if (!groups[r.task_id]) {
              groups[r.task_id] = { ...r };
            } else {
              groups[r.task_id].cost += r.cost;
              groups[r.task_id].total_tokens += r.total_tokens;
              // Keep the most recent timestamp
              if (new Date(r.created_at) > new Date(groups[r.task_id].created_at)) {
                groups[r.task_id].created_at = r.created_at;
              }
            }
          } else {
            orphans.push(r);
          }
        });

        const consolidated = [...Object.values(groups), ...orphans]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setCreditHistory(consolidated.slice(0, 10));
      }
    } catch (e) {
      console.error('Failed to fetch credit history:', e);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    fetchCreditHistory();
    const interval = setInterval(fetchUsage, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [fetchUsage, fetchCreditHistory]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const next = [...prev, msg];
      messagesRef.current = next;
      return next;
    });
  }, []);

  const saveSession = useCallback(async (msgs: ChatMessage[]) => {
    if (!window.bronAPI?.saveChatSession) return;
    const userMsgs = msgs.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return;
    
    const title = userMsgs[0].content.slice(0, 80) || 'New Chat';
    try {
      const id = await window.bronAPI.saveChatSession(
        title,
        msgs.map(m => ({
          id: m.id,
          role: (m.role === 'done' || m.role === 'agent') ? 'agent' : m.role,
          content: m.content,
          timestamp: m.timestamp,
          type: m.role === 'step' ? 'action' : undefined
        })),
        currentSessionId || undefined
      );
      if (!currentSessionId) setCurrentSessionId(id);
    } catch (e) {
      console.error('Failed to save session:', e);
    }
  }, [currentSessionId]);

  useEffect(() => {
    const handleLoad = (e: any) => {
      const { messages, sessionId } = e.detail;
      setMessages(messages);
      messagesRef.current = messages;
      setCurrentSessionId(sessionId);
    };
    window.addEventListener('bron:load-chat-session', handleLoad);
    return () => window.removeEventListener('bron:load-chat-session', handleLoad);
  }, []);

  useEffect(() => {
    if (!window.bronAPI) return;

    const unsubs = [
      window.bronAPI.onAgentStep((_: any, data: any) => {
        addMessage({
          id: `step_${Date.now()}_${Math.random()}`,
          role: 'step',
          content: data.message || JSON.stringify(data),
          timestamp: Date.now()
        });
      }),
      window.bronAPI.onAgentDone((_: any, data: any) => {
        const doneMessage =
          typeof data === 'string'
            ? data
            : (data && typeof data === 'object' && 'message' in data
                ? String((data as any).message || 'Task completed.')
                : 'Task completed.');
        addMessage({
          id: `done_${Date.now()}`,
          role: 'done',
          content: doneMessage,
          timestamp: Date.now()
        });
        setAgentRunning(false);
        onRefresh();
        fetchUsage();
        fetchCreditHistory();
        setTimeout(() => saveSession(messagesRef.current), 500);
      }),
      window.bronAPI.onAgentError((_: any, data: any) => {
        addMessage({
          id: `err_${Date.now()}`,
          role: 'error',
          content: typeof data === 'string' ? data : JSON.stringify(data),
          timestamp: Date.now()
        });
        setAgentRunning(false);
        fetchCreditHistory();
        setTimeout(() => saveSession(messagesRef.current), 500);
      })
    ];

    return () => unsubs.forEach(un => un());
  }, [addMessage, setAgentRunning, onRefresh, saveSession, fetchUsage, fetchCreditHistory]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'inherit';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleRun = async (chatModeFlag = false, overrideTask?: string) => {
    const task = (overrideTask || input).trim();
    if (!task || agentRunning) return;

    setInput('');
    setAttachments([]);
    addMessage({ id: `user_${Date.now()}`, role: 'user', content: task, timestamp: Date.now() });
    setAgentRunning(true);

    try {
      await window.bronAPI.runAgent({
        task,
        sessionId: currentSessionId || undefined,
        attachments,
        isChatMode: chatModeFlag,
        contextMessages: messagesRef.current
          .filter(m => ['user', 'done', 'error'].includes(m.role))
          .slice(-8)
          .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 1200)}`)
      });
    } catch (e) {
      addMessage({ id: `err_${Date.now()}`, role: 'error', content: `Start error: ${e}`, timestamp: Date.now() });
      setAgentRunning(false);
    }
  };

  const formatCreditValue = (row: CreditUsageRecord) => {
    if (row.cost > 0) return `$${row.cost.toFixed(4)}`;
    return `${row.total_tokens.toLocaleString()} tok`;
  };

  const formatCreditTime = (raw: string) => {
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const date = new Date(`${normalized}Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="w-[400px] flex-shrink-0 flex flex-col h-full bg-bron-panel border-l border-bron-border/10 shadow-2xl relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bron-bg/20 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${agentRunning ? 'bg-bron-accent/20 text-bron-accent animate-pulse' : 'bg-bron-surface text-bron-text-dim'}`}>
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-bron-text tracking-tight uppercase">Agent Explorer</h2>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${agentRunning ? 'bg-green-500 animate-pulse' : 'bg-bron-text-muted'}`} />
              <span className="text-[10px] text-bron-text-dim font-bold tracking-tighter">
                {agentRunning ? 'PROCESSING' : 'STANDBY'}
              </span>
              {usage && (
                <span className="text-[9px] text-bron-accent font-bold ml-1 px-1.5 py-0.5 bg-bron-accent/10 rounded-full">
                  {usage}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onOpenHistory} className="p-1.5 rounded-md hover:bg-bron-surface text-bron-text-dim hover:text-bron-text transition-colors" title="History">
            <Clock className="w-3.5 h-3.5" />
          </button>
          <button onClick={onOpenMemory} className="p-1.5 rounded-md hover:bg-bron-surface text-bron-text-dim hover:text-bron-text transition-colors" title="Memory">
            <Database className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-4 bg-bron-border mx-1" />
          <button onClick={() => setAgentRunning(false)} className="p-1.5 rounded-md hover:bg-bron-surface text-bron-text-dim hover:text-bron-text transition-colors" title="Close Sidebar" onClickCapture={(e) => { e.stopPropagation(); (window as any).bronToggleSidebar?.(); }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {creditHistory.length > 0 && (
        <div className="px-4 py-2.5 border-b border-bron-border/40 bg-bron-bg/20 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-bron-text-muted font-black">
              Session Credit History
            </p>
            <span className="text-[9px] text-bron-accent font-bold px-1.5 py-0.5 bg-bron-accent/10 rounded">
              RECENT RUNS
            </span>
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto no-scrollbar">
            {creditHistory.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center justify-between text-[10px] group">
                <div className="flex items-center gap-1.5 flex-1 min-w-0 pr-2">
                  <div className="w-1 h-1 rounded-full bg-bron-text-muted group-hover:bg-bron-accent transition-colors" />
                  <span className="text-bron-text-dim truncate font-medium">{row.model || 'model'}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-bron-accent font-black tabular-nums">{formatCreditValue(row)}</span>
                  <span className="text-bron-text-muted/60 tabular-nums font-mono text-[9px]">{formatCreditTime(row.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar no-scrollbar">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 opacity-40">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-b from-bron-surface to-transparent flex items-center justify-center mb-6">
              <Sparkles className="w-8 h-8 text-bron-accent" />
            </div>
            <p className="text-sm font-bold text-bron-text mb-1 uppercase tracking-widest">Autonomous Assistant</p>
            <p className="text-[11px] text-bron-text-dim font-medium leading-relaxed">Search, analyze, or automate the web using the current browser context.</p>
          </div>
        )}

        {(() => {
          const rendered: JSX.Element[] = [];
          let currentStepGroup: ChatMessage[] = [];

          messages.forEach((msg, idx) => {
            if (msg.role === 'step' || msg.type === 'action') {
              currentStepGroup.push(msg);
              return;
            }

            if (currentStepGroup.length > 0) {
              rendered.push(<StepGroups key={`group_${idx}`} steps={[...currentStepGroup]} />);
              currentStepGroup = [];
            }

            if (msg.role === 'user') {
              rendered.push(
                <div key={msg.id} className="flex flex-col items-end animate-slide-up group/msg">
                  <div className="relative max-w-[85%]">
                    <div className="chat-bubble-user px-4 py-2.5 shadow-lg">
                      <p className="text-[13.5px] font-medium leading-relaxed">{msg.content}</p>
                    </div>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        // Optional: add a temporary 'copied' state/toast here
                      }}
                      className="absolute -left-8 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-bron-surface text-bron-text-dim opacity-0 group-hover/msg:opacity-100 transition-all hover:text-bron-accent"
                      title="Copy Prompt"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="text-[9px] text-bron-text-muted mt-1 mr-1 uppercase font-bold tracking-tighter">User</span>
                </div>
              );
            } else if (msg.role === 'done' || msg.role === 'agent') {
              rendered.push(
                <div key={msg.id} className="animate-slide-up chat-bubble-agent overflow-hidden message-card-glow ring-1 ring-bron-border">
                   <div className="p-5" id={`result-${msg.id}`}>
                     <div className="result-header text-[10px] font-extrabold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-bron-accent" />
                        Agent Result
                     </div>
                     <FormattedResult content={msg.content} />
                   </div>
                   <div className="px-5 py-3 bg-bron-surface/50 border-t border-bron-border flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <button className="p-1.5 rounded-lg hover:bg-bron-bg text-bron-text-muted hover:text-bron-text transition-colors">
                         <ThumbsUp className="w-4 h-4" />
                       </button>
                       <button className="p-1.5 rounded-lg hover:bg-bron-bg text-bron-text-muted hover:text-bron-text transition-colors">
                         <ThumbsDown className="w-4 h-4" />
                       </button>
                     </div>
                     <div className="flex items-center gap-2">
                        <span className="text-[10px] text-bron-text-muted font-bold uppercase tracking-tighter mr-1">Export Result</span>
                        
                        {/* PDF/Print */}
                        <button 
                          onClick={() => {
                            let inTable = false;
                            let tableRowIdx = 0;
                            const htmlContent = msg.content
                              .split('\n')
                              .map(line => {
                                const t = line.trim();
                                if (t.startsWith('|')) {
                                  if (t.includes('---')) return null;
                                  const cells = t.split('|').slice(1, -1).map(c => c.trim());
                                  const isHeader = !inTable;
                                  inTable = true;
                                  const res = `<tr style="${isHeader ? 'background-color: #2a4365; color: white; font-weight: bold;' : (tableRowIdx % 2 === 0 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;')}">
                                    ${cells.map(c => `<td style="border: 1px solid #e2e8f0; padding: 12px; ${isHeader ? 'white-space: nowrap;' : ''}">${c}</td>`).join('')}
                                  </tr>`;
                                  tableRowIdx++;
                                  return res;
                                } else {
                                  if (inTable) { inTable = false; tableRowIdx = 0; }
                                  if (t.startsWith('###')) return `<h3 style="margin-top: 1.5em; color: #1e293b;">${t.replace(/^#{3,}\s*/, '')}</h3>`;
                                  if (t.startsWith('##')) return `<h2 style="margin-top: 1.8em; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">${t.replace(/^#{2}\s*/, '')}</h2>`;
                                  if (t.startsWith('#')) return `<h1 style="color: #3b82f6; font-size: 28px;">${t.replace(/^#\s*/, '')}</h1>`;
                                  
                                  // Detect "header-like" lines that don't have hashtags
                                  const isHeaderLike = t.length > 2 && t.length < 60 && !t.includes('.') && !t.startsWith('-') && !t.startsWith('*') && /^[A-Z]/.test(t);
                                  if (isHeaderLike) {
                                     return `<h2 style="margin-top: 1.8em; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">${t}</h2>`;
                                  }

                                  if (t === '') return '<br/>';
                                  
                                  // Basic bold support
                                  const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                                  return `<p style="margin-bottom: 0.8em;">${formatted}</p>`;
                                }
                              })
                              .filter(x => x !== null)
                              .join('')
                              .replace(/(<tr[\s\S]*?<\/tr>)+/g, match => `<table style="border-collapse: collapse; width: 100%; margin: 20px 0; border: 1px solid #e2e8f0;">${match}</table>`);

                            const fullHtml = `
                              <html>
                                <head>
                                  <title>Bron Research Report</title>
                                  <style>
                                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 50px; line-height: 1.6; color: #334155; max-width: 900px; margin: 0 auto; }
                                    .header { border-bottom: 4px solid #3b82f6; margin-bottom: 40px; padding-bottom: 20px; }
                                    .footer { margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
                                    table { border-collapse: collapse; width: 100%; margin: 30px 0; font-size: 13px; }
                                    th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
                                    h1, h2, h3 { font-family: "Segoe UI", sans-serif; font-weight: 700; }
                                    h1 { font-size: 32px; color: #0f172a; margin-bottom: 0.5em; }
                                    h2 { font-size: 22px; color: #0f172a; margin-top: 1.5em; }
                                    p { margin-bottom: 1em; font-size: 15px; }
                                    strong { color: #1e293b; font-weight: 600; }
                                  </style>
                                </head>
                                <body>
                                  <div class="header">
                                    <h1 style="margin:0; color:#3b82f6;">Research Report</h1>
                                    <p style="margin:8px 0 0; font-size:14px; color:#64748b; font-weight: bold;">GENERATED ON ${new Date().toLocaleString()}</p>
                                  </div>
                                  <div id="content">${htmlContent}</div>
                                  <div class="footer">Report generated by Bron Agentic Browser</div>
                                  <script>setTimeout(() => { window.print(); }, 1000);</script>
                                </body>
                              </html>
                            `;
                            window.bronAPI.openReportWindow(fullHtml);
                          }}
                          className="p-1.5 rounded-lg bg-bron-surface border border-bron-border text-bron-text-dim hover:text-bron-accent hover:border-bron-accent/50 active:scale-95 transition-all shadow-sm"
                          title="Export to PDF / Print"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>

                        {/* Word Export */}
                        <button 
                          onClick={() => {
                            let inTable = false;
                            let tableRowIdx = 0;
                            const htmlContent = msg.content
                              .split('\n')
                              .map(line => {
                                const t = line.trim();
                                if (t.startsWith('|')) {
                                  if (t.includes('---')) return null;
                                  const cells = t.split('|').slice(1, -1).map(c => c.trim());
                                  const isHeader = !inTable;
                                  inTable = true;
                                  const res = `<tr style="${isHeader ? 'background-color: #2a4365; color: white; font-weight: bold;' : (tableRowIdx % 2 === 0 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;')}">
                                    ${cells.map(c => `<td style="border: 1px solid #ddd; padding: 10px; ${isHeader ? 'white-space: nowrap;' : ''}">${c}</td>`).join('')}
                                  </tr>`;
                                  tableRowIdx++;
                                  return res;
                                } else {
                                  if (inTable) { inTable = false; tableRowIdx = 0; }
                                  if (t.startsWith('###')) return `<h3>${t.replace(/^#{3,}\s*/, '')}</h3>`;
                                  if (t.startsWith('##')) return `<h2>${t.replace(/^#{2}\s*/, '')}</h2>`;
                                  if (t.startsWith('#')) return `<h1>${t.replace(/^#\s*/, '')}</h1>`;
                                  if (t === '') return '<br/>';
                                  return `<p>${line}</p>`;
                                }
                              })
                              .filter(x => x !== null)
                              .join('')
                              .replace(/(<tr[\s\S]*?<\/tr>)+/g, match => `<table style="border-collapse: collapse; width: 100%; margin: 20px 0;">${match}</table>`);

                            const fullDocHtml = `
                              <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                                <head><meta charset='utf-8'></head>
                                <body style="font-family: Arial, sans-serif;">
                                  ${htmlContent}
                                </body>
                              </html>
                            `;
                            const blob = new Blob(['\ufeff', fullDocHtml], { type: 'application/msword' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `Bron_Report_${new Date().getTime()}.doc`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                          }}
                          className="p-1.5 rounded-lg bg-bron-surface border border-bron-border text-bron-text-dim hover:bg-bron-bg transition-all shadow-sm"
                          title="Export to Word"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                          }}
                          className="p-1.5 rounded-lg bg-bron-surface border border-bron-border text-bron-text-dim hover:bg-bron-bg transition-all shadow-sm"
                          title="Copy Raw Markdown"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => {
                             setInput('Continue');
                             handleRun(false, 'Continue');
                          }}
                          className="p-1.5 rounded-lg bg-bron-accent/10 border border-bron-accent/20 text-bron-accent hover:bg-bron-accent/20 transition-all shadow-sm ml-1"
                          title="Continue Task"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                   </div>
                </div>
              );
            } else if (msg.role === 'error') {
              rendered.push(
                <div key={msg.id} className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 animate-shake relative group">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-red-500/10 text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] font-extrabold text-red-500 uppercase tracking-widest">Execution Failed</p>
                      <p className="text-sm text-red-200/90 mt-1 leading-relaxed font-medium">{msg.content}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setInput('Continue after fixing error');
                      handleRun(false, 'Continue after fixing error');
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-all border border-red-500/20 hover:bg-red-500/20"
                    title="Retry/Continue"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              );
            }
          });

          if (currentStepGroup.length > 0) {
            rendered.push(<StepGroups key="final_group" steps={[...currentStepGroup]} />);
          }

          return rendered;
        })()}
        <div ref={scrollRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-transparent sticky bottom-0">
        <div className="bg-bron-surface/40 rounded-2xl p-1 relative ring-1 ring-bron-border/10 shadow-sm">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 animate-fade-in">
             {attachments.map(att => (
               <div key={att.id} className="group relative flex items-center gap-2 bg-bron-surface border border-bron-border/50 px-3 py-2 rounded-xl shadow-sm">
                  <Paperclip className="w-3.5 h-3.5 text-bron-accent" />
                  <span className="text-[11px] text-bron-text-dim font-bold truncate max-w-[120px]">{att.name}</span>
                  <button 
                    onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
               </div>
             ))}
          </div>
        )}

        <div className="relative group">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleRun();
              }
            }}
            placeholder="Describe a task or ask a question..."
            className="w-full chat-input-textarea bg-transparent rounded-2xl pl-4 pr-14 py-4 text-sm text-bron-text placeholder-bron-text-muted focus:outline-none transition-all no-scrollbar font-medium"
          />
          <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
             <button 
               onClick={() => setIsChatMode(!isChatMode)}
               className={`p-2 rounded-xl transition-all ${isChatMode ? 'text-bron-accent' : 'text-bron-text-dim'}`}
               title={isChatMode ? "Direct Chat Mode" : "Autonomous Research Mode"}
             >
               {isChatMode ? <MessageSquare className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
             </button>
             <button 
               onClick={async () => {
                 if (window.bronAPI?.pickAgentAttachments) {
                   const files = await window.bronAPI.pickAgentAttachments();
                   setAttachments(prev => [...prev, ...files].slice(0, 6));
                 }
               }}
               className="p-2 rounded-xl text-bron-text-dim hover:text-bron-text hover:bg-bron-surface transition-all"
               title="Attach Files"
             >
               <Paperclip className="w-4 h-4" />
             </button>
             <button
               onClick={agentRunning ? () => window.bronAPI?.stopAgent() : () => handleRun(isChatMode)}
               disabled={!input.trim() && !agentRunning}
               className={`p-2.5 rounded-xl shadow-lg transition-all active:scale-90 flex items-center justify-center ${
                 agentRunning 
                   ? 'bg-red-500 text-white shadow-red-500/30' 
                   : (input.trim() ? 'bg-bron-accent text-white shadow-bron-accent/30' : 'bg-bron-surface text-bron-text-muted opacity-50')
               }`}
             >
               {agentRunning ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
             </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);
};

export default AgentSidebar;
