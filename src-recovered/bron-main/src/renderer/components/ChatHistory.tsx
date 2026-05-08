import React, { useEffect, useState } from 'react';
import { X, Clock, MessageSquare, Trash2, Search, Calendar, ChevronRight } from 'lucide-react';

interface ChatSession {
  id: number;
  title: string;
  messages: any[];
  created_at: string;
  updated_at: string;
}

interface Props {
  onClose: () => void;
  onLoadSession: (messages: any[], id: number) => void;
}

const ChatHistory: React.FC<Props> = ({ onClose, onLoadSession }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    if (!window.bronAPI) return;
    setLoading(true);
    try {
      const data = await window.bronAPI.getChatSessions();
      setSessions(data || []);
    } catch (e) {
      console.error('Failed to load chat history:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (id: number) => {
    if (!window.bronAPI) return;
    try {
      const session = await window.bronAPI.getChatSession(id);
      if (session && session.messages) {
        onLoadSession(session.messages, id);
      }
    } catch (e) {
      console.error('Failed to load session details:', e);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!window.bronAPI || !confirm('Are you sure you want to delete this chat session?')) return;
    try {
      await window.bronAPI.deleteChatSession(id);
      setSessions(sessions.filter(s => s.id !== id));
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-bron-panel border border-bron-border w-full max-w-md h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-5 border-b border-bron-border flex items-center justify-between bg-bron-bg/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-bron-accent/20 text-bron-accent">
              <Clock className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-bron-text tracking-tight">Chat History</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bron-surface transition-colors text-bron-text-dim">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-bron-border bg-bron-surface/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bron-text-muted" />
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-bron-surface border border-bron-border rounded-xl pl-10 pr-4 py-2 text-sm text-bron-text focus:border-bron-accent/50 transition-all outline-none"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-6 h-6 border-2 border-bron-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-bron-text-dim font-medium uppercase tracking-widest">Retrieving History</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-center opacity-40">
              <MessageSquare className="w-10 h-10 mb-4" />
              <p className="text-sm font-medium">No conversations yet</p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div 
                key={session.id}
                onClick={() => handleSelect(session.id)}
                className="group flex items-center gap-4 p-4 rounded-2xl bg-bron-surface/50 border border-transparent hover:border-bron-accent/30 hover:bg-bron-surface transition-all cursor-pointer relative overflow-hidden"
              >
                <div className="p-2.5 rounded-xl bg-bron-bg border border-bron-border group-hover:border-bron-accent/20 transition-all">
                  <MessageSquare className="w-4 h-4 text-bron-text-dim group-hover:text-bron-accent transition-colors" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-bron-text truncate pr-8 group-hover:text-bron-accent transition-colors">
                    {session.title || 'Untitled Session'}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1 text-[10px] text-bron-text-dim font-medium">
                      <Calendar className="w-3 h-3" />
                      {new Date(session.updated_at).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-bron-accent font-bold uppercase tracking-tighter">
                      {session.messages?.length || 0} messages
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                   <button 
                     onClick={(e) => handleDelete(e, session.id)}
                     className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all"
                     title="Delete Session"
                   >
                     <Trash2 className="w-3.5 h-3.5" />
                   </button>
                   <ChevronRight className="w-4 h-4 text-bron-accent" />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-bron-border bg-bron-bg/50">
           <p className="text-[10px] text-center text-bron-text-muted font-bold uppercase tracking-[0.2em]">
             Local Browser Data — Secured via SQL.JS
           </p>
        </div>
      </div>
    </div>
  );
};

export default ChatHistory;
