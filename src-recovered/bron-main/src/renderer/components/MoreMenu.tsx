import React from 'react';
import { 
  Plus, 
  AppWindow as WindowIcon, 
  Shield, 
  User, 
  Key, 
  History, 
  Download, 
  Bookmark, 
  Layers, 
  Puzzle, 
  Trash2, 
  Search, 
  Printer, 
  Image as ImageIcon, 
  Languages, 
  Tv as Monitor, 
  Settings, 
  Info, 
  LogOut,
  Minus,
  Maximize2,
  Globe
} from 'lucide-react';

interface MoreMenuProps {
  onClose: () => void;
  onNewTab: () => void;
  onOpenSettings: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onNewWindow: () => void;
  onNewIncognitoWindow: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
  onClearData: () => void;
  onExit: () => void;
  currentTheme: 'light' | 'dark' | 'medium';
  onSwitchTheme: (theme: 'light' | 'dark' | 'medium') => void;
  onAbout: () => void;
  onNavigate: (url: string) => void;
}

const MoreMenu: React.FC<MoreMenuProps> = ({ 
  onClose, 
  onNewTab, 
  onOpenSettings,
  onZoomIn,
  onZoomOut,
  onNewWindow,
  onNewIncognitoWindow,
  onOpenHistory,
  onOpenDownloads,
  onClearData,
  onExit,
  currentTheme,
  onSwitchTheme,
  onAbout,
  onNavigate
}) => {
  const MenuItem = ({ icon: Icon, label, shortcut, onClick, danger = false }: any) => (
    <button
      onClick={() => {
        if (onClick) onClick();
        onClose();
      }}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors group ${danger ? 'text-bron-danger hover:bg-bron-danger/10' : 'text-bron-text-dim hover:bg-bron-surface/50 hover:text-bron-text'}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`w-4 h-4 ${danger ? '' : 'group-hover:text-bron-accent'}`} />
        <span className="text-xs font-bold">{label}</span>
      </div>
      {shortcut && <span className="text-[9px] font-black opacity-30 group-hover:opacity-60">{shortcut}</span>}
    </button>
  );

  return (
    <div className="absolute top-11 right-2 w-72 bg-bron-panel border border-bron-border/50 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.6)] backdrop-blur-2xl z-[100] animate-slide-up overflow-hidden p-1.5">
      
      <div className="space-y-0.5">
        <MenuItem icon={Plus} label="New tab" shortcut="Ctrl+T" onClick={onNewTab} />
        <MenuItem icon={Layers} label="New tab group" shortcut="Alt+Shift+P" />
        <MenuItem icon={WindowIcon} label="New window" shortcut="Ctrl+N" onClick={onNewWindow} />
        <MenuItem icon={Shield} label="New Incognito window" shortcut="Ctrl+Shift+N" onClick={onNewIncognitoWindow} />
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      {/* Theme Switcher */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-bron-text-dim">
          <Monitor className="w-4 h-4" />
          <span className="text-xs font-bold">Theme</span>
        </div>
        <div className="flex items-center gap-1 bg-bron-bg rounded-lg p-0.5 border border-bron-border/30">
          <button 
            onClick={() => { onSwitchTheme('light'); onClose(); }} 
            className={`px-2 py-1 text-[9px] font-black rounded transition-all ${currentTheme === 'light' ? 'bg-bron-accent text-white shadow-lg' : 'hover:bg-bron-surface'}`}
          >
            LIGHT
          </button>
          <button 
            onClick={() => { onSwitchTheme('medium'); onClose(); }} 
            className={`px-2 py-1 text-[9px] font-black rounded transition-all ${currentTheme === 'medium' ? 'bg-bron-accent text-white shadow-lg' : 'hover:bg-bron-surface'}`}
          >
            MEDIUM
          </button>
          <button 
            onClick={() => { onSwitchTheme('dark'); onClose(); }} 
            className={`px-2 py-1 text-[9px] font-black rounded transition-all ${currentTheme === 'dark' ? 'bg-bron-accent text-white shadow-lg' : 'hover:bg-bron-surface'}`}
          >
            DARK
          </button>
        </div>
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      {/* Dalvi Cloud Section */}
      <div className="px-3 py-1 flex items-center gap-2 opacity-60">
        <Globe className="w-3 h-3" />
        <span className="text-[9px] font-black uppercase tracking-wider">Dalvi Cloud Services</span>
      </div>
      <div className="space-y-0.5">
        <MenuItem icon={Globe} label="Dalvi Links" onClick={() => onNavigate('https://links.dalvi.cloud')} />
        <MenuItem icon={User} label="Dalvi Cards" onClick={() => onNavigate('https://cards.dalvi.cloud')} />
        <MenuItem icon={Maximize2} label="Dalvi 3D" onClick={() => onNavigate('https://3d.dalvi.cloud')} />
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      <div className="space-y-0.5">
        <MenuItem icon={Key} label="Passwords and autofill" />
        <MenuItem icon={History} label="History" shortcut="Ctrl+H" onClick={onOpenHistory} />
        <MenuItem icon={Download} label="Downloads" shortcut="Ctrl+J" onClick={onOpenDownloads} />
        <MenuItem icon={Bookmark} label="Bookmarks and lists" />
        <MenuItem icon={Puzzle} label="Extensions" />
        <MenuItem icon={Trash2} label="Delete browsing data" shortcut="Ctrl+Shift+Del" onClick={onClearData} />
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      {/* Zoom Control */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-bron-text-dim">
          <Search className="w-4 h-4" />
          <span className="text-xs font-bold">Zoom</span>
        </div>
        <div className="flex items-center gap-1 bg-bron-bg rounded-lg p-0.5 border border-bron-border/30">
          <button onClick={onZoomOut} className="p-1 hover:bg-bron-surface rounded transition-colors"><Minus className="w-3 h-3 text-bron-text" /></button>
          <span className="text-[10px] font-black px-2 w-10 text-center">100%</span>
          <button onClick={onZoomIn} className="p-1 hover:bg-bron-surface rounded transition-colors"><Plus className="w-3 h-3 text-bron-text" /></button>
          <button className="p-1 hover:bg-bron-surface rounded transition-colors ml-1 border-l border-bron-border/20 pl-2"><Maximize2 className="w-3 h-3 text-bron-text" /></button>
        </div>
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      <div className="space-y-0.5">
        <MenuItem icon={Printer} label="Print..." shortcut="Ctrl+P" />
        <MenuItem icon={ImageIcon} label="Search with Image Search" />
        <MenuItem icon={Languages} label="Translate..." />
        <MenuItem icon={Monitor} label="Cast, save, and share" />
      </div>

      <div className="my-1.5 border-t border-bron-border/20 mx-2" />

      <div className="space-y-0.5">
        <MenuItem icon={Info} label="About Bron" onClick={onAbout} />
        <MenuItem icon={Settings} label="Settings" onClick={onOpenSettings} />
        <MenuItem icon={LogOut} label="Exit" danger onClick={onExit} />
      </div>
    </div>
  );
};

export default MoreMenu;
