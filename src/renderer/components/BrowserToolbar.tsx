import React, { useState, KeyboardEvent, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Plus,
  Settings,
  PanelRightOpen,
  PanelRightClose,
  Globe,
  Search,
  Zap,
  X,
  ZoomIn,
  ZoomOut,
  Home,
  User,
  MoreHorizontal
} from 'lucide-react';
import type { TabInfo, Settings as SettingsType } from '../../shared/types';
import ProfileMenu from './ProfileMenu';
import MoreMenu from './MoreMenu';

interface Props {
  url: string;
  tabs: TabInfo[];
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onNewTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  sidebarOpen: boolean;
  isLoading: boolean;
  agentRunning?: boolean;
  agentElapsedMs?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  currentProfile: string;
  onSwitchProfile: (name: string) => void;
  onOpenHistory: () => void;
  currentTheme: 'light' | 'dark' | 'medium';
  onSwitchTheme: (theme: 'light' | 'dark' | 'medium') => void;
  onAbout: () => void;
}

const BrowserToolbar: React.FC<Props> = ({
  url,
  tabs = [],
  onNavigate,
  onBack,
  onForward,
  onRefresh,
  onNewTab,
  onSwitchTab,
  onCloseTab,
  onToggleSidebar,
  onOpenSettings,
  sidebarOpen,
  isLoading,
  agentRunning = false,
  agentElapsedMs = 0,
  onZoomIn,
  onZoomOut,
  currentProfile,
  onSwitchProfile,
  onOpenHistory,
  currentTheme,
  onSwitchTheme,
  onAbout,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    if (!isFocused) setInputValue(url);
  }, [url, isFocused]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      onNavigate(inputValue.trim());
      setIsFocused(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  const btnClass = "w-7 h-7 flex items-center justify-center rounded-md text-bron-text-dim hover:text-bron-text hover:bg-bron-surface transition-all duration-200 active:scale-90 flex-shrink-0";

  const formatDuration = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-1.5 px-3 bg-bron-bg border-b border-bron-border/10 select-none h-[42px] overflow-hidden" style={{ WebkitAppRegion: 'drag' } as any}>
      
      {/* Left: Navigation */}
      <div className="flex items-center gap-1 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button onClick={onBack} className={btnClass} title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={onForward} className={btnClass} title="Forward">
          <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={onRefresh} className={btnClass} title="Refresh">
          <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={() => onNavigate('https://www.google.com')} className={btnClass} title="Home">
          <Home className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Address Bar & Tabs Merged Area */}
      <div className="flex-1 flex items-center gap-2 min-w-0 h-full px-2">
        {/* Address Bar */}
        <div className="flex-shrink-0 flex items-center min-w-[200px] w-[320px]" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="relative w-full group">
            <div className={`
              absolute inset-0 bg-bron-accent/5 rounded-xl blur-lg transition-opacity duration-500
              ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}
            `} />
            <div className={`
              relative flex items-center bg-bron-panel border transition-all duration-300 rounded-lg px-2.5 h-[32px]
              ${isFocused ? 'border-bron-accent/40 ring-4 ring-bron-accent/5' : 'border-bron-border/50 group-hover:border-bron-text-muted/20'}
            `}>
              <Search className={`w-3.5 h-3.5 mr-2 transition-colors ${isFocused ? 'text-bron-accent' : 'text-bron-text-muted'}`} />
              <input
                id="address-bar"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border-none text-[11px] font-bold text-bron-text outline-none truncate"
                placeholder="Search or enter URL"
              />
              {agentRunning && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-bron-accent/10 border border-bron-accent/20 ml-2">
                  <Zap className="w-2.5 h-2.5 text-bron-accent animate-pulse" />
                  <span className="text-[9px] font-black text-bron-accent tabular-nums">
                    {formatDuration(agentElapsedMs)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs Scroll Area */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar ml-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              className={`
                group relative flex items-center gap-1.5 px-2.5 h-[32px] rounded-lg transition-all duration-300 cursor-pointer flex-shrink-0 min-w-[100px] max-w-[140px] border border-transparent
                ${tab.active 
                  ? 'bg-bron-panel border-bron-border/50 text-bron-text shadow-lg' 
                  : 'text-bron-text-muted hover:bg-bron-surface/40 hover:text-bron-text-dim'}
              `}
            >
              <Globe className={`w-2.5 h-2.5 flex-shrink-0 transition-colors ${tab.active ? 'text-bron-accent' : 'text-bron-text-muted'}`} />
              <span className={`text-[10px] font-bold truncate flex-1 ${tab.active ? '' : 'opacity-60'}`}>
                {tab.title || 'New Tab'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
              {tab.active && (
                 <div className="absolute bottom-0 left-2 right-2 h-[1.5px] bg-bron-accent shadow-[0_0_8px_rgba(59,130,246,0.8)] rounded-full" />
              )}
            </div>
          ))}
          <button
            onClick={onNewTab}
            className="w-7 h-7 flex items-center justify-center rounded-md text-bron-text-muted hover:text-bron-text hover:bg-bron-surface/50 ml-0.5 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right: Actions & Window Control Space */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-auto pr-[138px]" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="w-[1px] h-4 bg-bron-border/40 mx-1" />
        
        <button 
          onClick={() => setShowProfileMenu(!showProfileMenu)} 
          className={`${btnClass} ${showProfileMenu ? 'bg-bron-accent/10 border-bron-accent/30' : ''}`} 
          title="Profile"
        >
          <div className="w-6 h-6 rounded-full bg-bron-surface flex items-center justify-center border border-bron-border/50 overflow-hidden relative group">
            {currentProfile !== 'default' ? (
               <div className="absolute inset-0 bg-bron-accent/20 flex items-center justify-center text-[8px] font-black uppercase">
                 {currentProfile.slice(0, 2)}
               </div>
            ) : (
              <User className="w-3.5 h-3.5 text-bron-text-dim" />
            )}
          </div>
        </button>

        <button onClick={onOpenSettings} className={btnClass} title="Settings">
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={onToggleSidebar}
          className={`${btnClass} ${sidebarOpen ? 'text-bron-accent bg-bron-accent/10' : ''}`}
          title="Toggle Sidebar"
        >
          {sidebarOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>

        <button 
          onClick={() => setShowMoreMenu(!showMoreMenu)} 
          className={`${btnClass} ${showMoreMenu ? 'bg-bron-accent/10' : ''}`} 
          title="More"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {showProfileMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setShowProfileMenu(false)} />
          <ProfileMenu 
            currentProfile={currentProfile}
            onClose={() => setShowProfileMenu(false)}
            onSwitchProfile={(name) => {
              onSwitchProfile(name);
              setShowProfileMenu(false);
            }}
            onOpenSettings={onOpenSettings}
          />
        </>
      )}

      {showMoreMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setShowMoreMenu(false)} />
          <MoreMenu 
            onClose={() => setShowMoreMenu(false)}
            onNewTab={onNewTab}
            onOpenSettings={onOpenSettings}
            onZoomIn={onZoomIn || (() => {})}
            onZoomOut={onZoomOut || (() => {})}
            onNewWindow={() => window.bronAPI.newWindow()}
            onNewIncognitoWindow={() => window.bronAPI.newIncognitoWindow()}
            onOpenHistory={onOpenHistory}
            onOpenDownloads={() => window.bronAPI.openDownloads()}
            currentTheme={currentTheme}
            onSwitchTheme={onSwitchTheme}
            onAbout={onAbout}
            onNavigate={onNavigate}
            onClearData={() => {
              if (confirm('Are you sure you want to clear all browsing data?')) {
                window.bronAPI.clearData();
              }
            }}
            onExit={() => window.bronAPI.exitApp()}
          />
        </>
      )}
    </div>
  );
};

export default BrowserToolbar;
