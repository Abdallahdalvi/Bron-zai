import React from 'react';
import { Globe, X, Plus, ChevronRight, ChevronLeft } from 'lucide-react';
import type { TabInfo } from '../../shared/types';

interface Props {
  tabs: TabInfo[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const VerticalTabs: React.FC<Props> = ({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
  isExpanded,
  onToggleExpand,
}) => {
  return (
    <div className={`
      flex flex-col h-full bg-bron-panel border-r border-bron-border transition-all duration-300 ease-in-out z-20
      ${isExpanded ? 'w-[200px]' : 'w-[64px]'}
    `}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-bron-border/50">
        {isExpanded && <span className="text-[10px] font-black text-bron-text-dim uppercase tracking-[0.2em]">Open Tabs</span>}
        <button 
          onClick={onToggleExpand}
          className="p-1.5 rounded-lg hover:bg-bron-surface text-bron-text-muted hover:text-bron-text transition-colors mx-auto"
        >
          {isExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Tabs List */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            className={`
              group relative flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-200
              ${tab.id === activeTabId 
                ? 'bg-bron-accent/15 text-bron-accent shadow-[0_0_15px_rgba(59,130,246,0.15)] border border-bron-accent/20' 
                : 'text-bron-text-dim hover:bg-bron-surface/80 hover:text-bron-text border border-transparent'}
            `}
          >
            <div className={`
              w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center transition-all
              ${tab.id === activeTabId ? 'bg-bron-accent text-white shadow-lg rotate-3 scale-110' : 'bg-bron-bg text-bron-text-muted group-hover:bg-bron-surface'}
            `}>
              <Globe className="w-4 h-4" />
            </div>
            
            {isExpanded && (
              <span className="text-[11px] font-bold truncate flex-1 leading-none tracking-tight">
                {tab.title || 'New Tab'}
              </span>
            )}

            {isExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-red-500/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            {/* Active Indicator Pin */}
            {tab.id === activeTabId && !isExpanded && (
              <div className="absolute left-[-8px] top-1/2 -translate-y-1/2 w-1 h-4 bg-bron-accent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
            )}
          </div>
        ))}
      </div>

      {/* Footer / New Tab */}
      <div className="p-3 border-t border-bron-border/50">
        <button
          onClick={onNewTab}
          className={`
            flex items-center gap-3 p-2.5 rounded-xl bg-bron-surface hover:bg-bron-accent hover:text-white transition-all duration-300 w-full group
            ${isExpanded ? 'px-4' : 'justify-center'}
          `}
        >
          <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
          {isExpanded && <span className="text-[11px] font-black uppercase tracking-widest">New Tab</span>}
        </button>
      </div>
    </div>
  );
};

export default VerticalTabs;
