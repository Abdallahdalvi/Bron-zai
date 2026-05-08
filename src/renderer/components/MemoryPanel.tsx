import React, { useEffect, useState } from 'react';
import { X, Trash2, Database, HardDrive, Search, ExternalLink, MessageSquare } from 'lucide-react';

interface Memory {
  id: number;
  key: string;
  value: string;
  source: string;
  session_id?: number;
  task_id?: number;
  created_at: string;
}

interface Props {
  onClose: () => void;
  onViewChat?: (sessionId: number) => void;
}

const MemoryPanel: React.FC<Props> = ({ onClose, onViewChat }) => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchTerm, setSearchSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchMemories = async () => {
    if (!window.bronAPI) return;
    setLoading(true);
    try {
      const data = await window.bronAPI.getMemories();
      setMemories(data || []);
    } catch (e) {
      console.error('Failed to fetch memories:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleClearAll = async () => {
    if (!window.bronAPI || !confirm('Are you sure you want to clear all agent memories?')) return;
    try {
      await window.bronAPI.clearMemories();
      setMemories([]);
    } catch (e) {
      console.error('Failed to clear memories:', e);
    }
  };

  const filteredMemories = memories.filter(m => 
    m.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-bron-panel border border-bron-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-bron-border flex items-center justify-between bg-bron-bg/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-bron-accent/20 text-bron-accent">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-bron-text">Agent Memory</h2>
              <p className="text-xs text-bron-text-dim">Persisted context and learned patterns</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All
            </button>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-bron-surface transition-colors text-bron-text-dim">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-bron-border bg-bron-surface/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bron-text-muted" />
            <input 
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchSearchTerm(e.target.value)}
              placeholder="Search memories..."
              className="w-full bg-bron-surface border border-bron-border rounded-xl pl-10 pr-4 py-2 text-sm text-bron-text focus:border-bron-accent/50 transition-all outline-none"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-8 h-8 border-2 border-bron-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-bron-text-dim">Loading memory bank...</p>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center opacity-40">
              <HardDrive className="w-12 h-12 mb-4" />
              <p className="text-sm">No memories found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredMemories.map((memory) => (
                <div key={memory.id} className="group bg-bron-surface border border-bron-border rounded-xl p-4 hover:border-bron-accent/30 transition-all shadow-sm">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-bron-accent/10 text-bron-accent text-[10px] font-bold uppercase tracking-wider">
                        {memory.key}
                      </span>
                      <span className="text-[10px] text-bron-text-muted font-medium italic">
                        via {memory.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {memory.session_id && (
                        <button 
                          onClick={() => onViewChat?.(memory.session_id!)}
                          className="flex items-center gap-1 text-[10px] text-bron-accent font-bold hover:underline"
                        >
                          <MessageSquare className="w-3 h-3" />
                          VIEW CHAT
                        </button>
                      )}
                      <span className="text-[10px] text-bron-text-muted">
                        {new Date(memory.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-bron-text-dim leading-relaxed group-hover:text-bron-text transition-colors">
                    {memory.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-bron-border bg-bron-bg/50 flex items-center justify-between">
          <span className="text-[10px] text-bron-text-muted font-medium tracking-widest uppercase">
            {memories.length} Persisted Items
          </span>
          <div className="flex items-center gap-1.5 text-[10px] text-bron-accent font-semibold uppercase tracking-widest">
            <ExternalLink className="w-3 h-3" />
            SQLite WASM Backend
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryPanel;