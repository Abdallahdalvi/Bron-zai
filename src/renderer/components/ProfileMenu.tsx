import React, { useEffect, useState } from 'react';
import { 
  User, 
  UserPlus, 
  Settings, 
  Check, 
  ChevronRight,
  LogOut,
  Shield,
  Zap
} from 'lucide-react';

interface ProfileMenuProps {
  currentProfile: string;
  onClose: () => void;
  onSwitchProfile: (name: string) => void;
  onOpenSettings: () => void;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ 
  currentProfile, 
  onClose, 
  onSwitchProfile,
  onOpenSettings
}) => {
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const list = await window.bronAPI.getProfiles();
        setProfiles(list);
      } catch (err) {
        console.error('Failed to load profiles:', err);
      } finally {
        setLoading(false);
      }
    };
    loadProfiles();
  }, []);

  const handleAddProfile = () => {
    const name = prompt('Enter profile name:');
    if (name && name.trim()) {
      onSwitchProfile(name.trim().toLowerCase());
    }
  };

  return (
    <div className="absolute top-11 right-12 w-72 bg-bron-panel border border-bron-border/50 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl z-[100] animate-slide-up overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-gradient-to-br from-bron-accent/10 to-transparent border-b border-bron-border/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-bron-accent/20 flex items-center justify-center border border-bron-accent/30 shadow-inner">
            <User className="w-6 h-6 text-bron-accent" />
          </div>
          <div>
            <h3 className="text-sm font-black text-bron-text">Browser Profile</h3>
            <p className="text-[10px] font-bold text-bron-text-dim uppercase tracking-wider">Active: {currentProfile}</p>
          </div>
        </div>
      </div>

      {/* Profiles List */}
      <div className="p-2 max-h-64 overflow-y-auto no-scrollbar">
        <div className="px-3 py-2 text-[9px] font-black text-bron-text-muted uppercase tracking-[0.2em]">Switch Profile</div>
        {profiles.map((p) => (
          <button
            key={p}
            onClick={() => onSwitchProfile(p)}
            className={`
              w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group
              ${p === currentProfile 
                ? 'bg-bron-accent/10 text-bron-accent' 
                : 'text-bron-text-dim hover:bg-bron-surface/40 hover:text-bron-text'}
            `}
          >
            <div className="flex items-center gap-3">
              <div className={`
                w-8 h-8 rounded-lg flex items-center justify-center border transition-colors
                ${p === currentProfile ? 'bg-bron-accent/20 border-bron-accent/30' : 'bg-bron-panel border-bron-border/50 group-hover:border-bron-text-dim/30'}
              `}>
                <User className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold">{p}</span>
            </div>
            {p === currentProfile && <Check className="w-4 h-4" />}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-bron-border/30 bg-black/10">
        <button
          onClick={handleAddProfile}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-bron-text-dim hover:bg-bron-surface/40 hover:text-bron-text transition-all duration-200"
        >
          <div className="w-8 h-8 rounded-lg bg-bron-panel border border-bron-border/50 flex items-center justify-center">
            <UserPlus className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold">Add Profile</span>
        </button>
        
        <div className="my-1 border-t border-bron-border/10" />
        
        <button
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-bron-text-dim hover:bg-bron-surface/40 hover:text-bron-text transition-all duration-200"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-bron-panel border border-bron-border/50 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold">Profile Settings</span>
          </div>
          <ChevronRight className="w-4 h-4 opacity-30" />
        </button>
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-bron-accent/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-3 h-3 text-bron-accent/60" />
          <span className="text-[9px] font-bold text-bron-text-muted">Isolated Containers</span>
        </div>
        <Zap className="w-3 h-3 text-bron-success animate-pulse" />
      </div>
    </div>
  );
};

export default ProfileMenu;
