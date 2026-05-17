import React, { useMemo, useState } from 'react';
import { Star, Search, X, ExternalLink, Trash2 } from 'lucide-react';
import type { BookmarkEntry } from '../../shared/types';

interface BookmarksPanelProps {
  bookmarks: BookmarkEntry[];
  currentUrl: string;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onRefresh: () => Promise<void>;
}

export default function BookmarksPanel({
  bookmarks,
  currentUrl,
  onClose,
  onNavigate,
  onRefresh,
}: BookmarksPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const normalizeComparableUrl = (url: string) =>
    String(url || '').trim().replace(/\/$/, '').replace(/#.*$/, '');

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bookmarks;
    return bookmarks.filter(
      (entry) =>
        entry.title.toLowerCase().includes(query) ||
        entry.url.toLowerCase().includes(query) ||
        entry.folder.toLowerCase().includes(query),
    );
  }, [bookmarks, searchQuery]);

  const removeBookmark = async (id: number) => {
    try {
      setBusyId(id);
      await window.bronAPI.removeBookmark(id);
      await onRefresh();
    } catch (err) {
      console.error('Failed to remove bookmark:', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-3xl max-h-[80vh] bg-bron-panel border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-bron-accent/20 flex items-center justify-center">
              <Star className="w-5 h-5 text-bron-accent" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Bookmarks</h2>
              <p className="text-xs text-bron-text-dim">Saved pages you can reopen instantly</p>
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
              placeholder="Search bookmarks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-bron-accent/50 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center mb-4">
                <Star className="w-8 h-8 text-white/20" />
              </div>
              <p className="text-white/40 text-sm font-medium">No bookmarks found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => {
                const active = normalizeComparableUrl(item.url) === normalizeComparableUrl(currentUrl);
                return (
                  <div
                    key={item.id}
                    className={`group flex items-center justify-between p-4 rounded-2xl border transition-all ${
                      active
                        ? 'bg-bron-accent/10 border-bron-accent/30'
                        : 'hover:bg-white/5 border-transparent hover:border-white/5'
                    }`}
                  >
                    <button
                      onClick={() => onNavigate(item.url)}
                      className="flex items-center gap-4 min-w-0 text-left flex-1"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                        <Star className={`w-5 h-5 ${active ? 'text-bron-accent' : 'text-white/40'}`} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white truncate">{item.title || item.url}</h4>
                        <p className="text-[11px] text-bron-text-dim truncate opacity-60">{item.url}</p>
                        <p className="text-[10px] text-bron-text-muted mt-1 uppercase tracking-widest">{item.folder}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <button
                        onClick={() => onNavigate(item.url)}
                        className="w-9 h-9 rounded-xl bg-white/0 hover:bg-white/10 flex items-center justify-center transition-all"
                        title="Open bookmark"
                      >
                        <ExternalLink className="w-4 h-4 text-white/50" />
                      </button>
                      <button
                        onClick={() => removeBookmark(item.id)}
                        disabled={busyId === item.id}
                        className="w-9 h-9 rounded-xl bg-white/0 hover:bg-red-500/10 disabled:opacity-50 flex items-center justify-center transition-all"
                        title="Delete bookmark"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
