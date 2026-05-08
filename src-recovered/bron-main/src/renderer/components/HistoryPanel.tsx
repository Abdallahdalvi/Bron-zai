import React, { useEffect, useState } from 'react';
import { X, Globe, Clock, Search, Trash2, ExternalLink } from 'lucide-react';

interface HistoryEntry {
  url: string;
  title: string;
  visited_at: string;
}

interface HistoryPanelProps {
  onClose: () => void;
  onNavigate: (url: string) => void;
}

export default function HistoryPanel({ onClose, onNavigate }: HistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!window.bronAPI) return;
      try {
        const data = await window.bronAPI.getHistory();
        setHistory(data);
      } catch (err) {
        console.error('Failed to fetch history:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const filteredHistory = history.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-3xl max-h-[80vh] bg-bron-panel border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-bron-accent/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-bron-accent" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Browsing History</h2>
              <p className="text-xs text-bron-text-dim">Your recent activity</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-bron-accent/50 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-4">
              <div className="w-8 h-8 border-2 border-bron-accent/30 border-t-bron-accent rounded-full animate-spin" />
              <p className="text-xs text-bron-text-dim uppercase tracking-widest font-bold">Loading History...</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-white/20" />
              </div>
              <p className="text-white/40 text-sm font-medium">No history entries found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((item, idx) => (
                <div 
                  key={idx}
                  className="group flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/5 transition-all cursor-pointer"
                  onClick={() => {
                    onNavigate(item.url);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                      <Globe className="w-5 h-5 text-white/40 group-hover:text-bron-accent transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">{item.title || item.url}</h4>
                      <p className="text-[11px] text-bron-text-dim truncate opacity-60">{item.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-[10px] text-white/20 font-medium">{formatDate(item.visited_at)}</span>
                    <button className="w-8 h-8 rounded-lg bg-white/0 hover:bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                      <ExternalLink className="w-4 h-4 text-white/40" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 flex items-center justify-between bg-white/5">
          <p className="text-[10px] text-bron-text-dim font-bold uppercase tracking-widest">
            {filteredHistory.length} ENTRIES FOUND
          </p>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-all">
            <Trash2 className="w-4 h-4" />
            Clear All History
          </button>
        </div>
      </div>
    </div>
  );
}
