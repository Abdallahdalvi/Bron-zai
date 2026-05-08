import React, { useEffect, useState, useCallback } from 'react';
import { X, Settings, Cpu, Globe, Key, Shield, Save, Check, RefreshCw, DollarSign } from 'lucide-react';

interface Props {
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({ onClose }) => {
  const [settings, setSettings] = useState<Record<string, any>>({
    apiKey: '',
    model: 'google/gemini-2.0-pro-exp-02-05:free',
    headless: false,
    theme: 'dark',
  });
  const [models, setModels] = useState<import('../../shared/types').ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  const fetchCredits = useCallback(async (key: string) => {
    if (!key || (!key.startsWith('sk-or-') && key.length < 20)) return;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (data?.data?.total_credits !== undefined) {
        const total = Number(data.data.total_credits);
        const usage = Number(data.data.total_usage || 0);
        setCredits(total - usage);
      }
    } catch (e) {
      console.error('Failed to fetch credits:', e);
    }
  }, []);

  const loadSettings = async () => {
    if (!window.bronAPI) return;
    setLoading(true);
    try {
      const s = await window.bronAPI.getSettings();
      if (s) {
        setSettings({
          apiKey: s.apiKey || '',
          model: s.model || 'google/gemma-2-9b-it',
          headless: !!s.headless,
          theme: s.theme || 'dark'
        });
        if (s.apiKey) fetchCredits(s.apiKey);
      }
      const m = await window.bronAPI.getModels();
      setModels(m || []);
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!window.bronAPI) return;
    setLoading(true);
    try {
      await window.bronAPI.saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (settings.apiKey) fetchCredits(settings.apiKey);
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-bron-panel border border-bron-border w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="px-6 py-5 border-b border-bron-border flex items-center justify-between bg-bron-bg/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-bron-accent/20 text-bron-accent">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-bron-text tracking-tight">Preferences</h2>
              <p className="text-[10px] text-bron-text-dim uppercase font-bold tracking-widest">Configuration & API Keys</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bron-surface transition-colors text-bron-text-dim">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Intelligence Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Cpu className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Intelligence</h3>
            </div>
            
            <div className="space-y-4 ml-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                   <label className="text-xs font-bold text-bron-text-dim">OpenRouter API Key</label>
                   {credits !== null && (
                     <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold">
                       <DollarSign className="w-3 h-3" />
                       {credits.toFixed(2)} CREDITS REMAINING
                     </div>
                   )}
                </div>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bron-text-muted" />
                  <input 
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder="sk-or-v1-..."
                    className="w-full bg-bron-surface border border-bron-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-bron-text focus:border-bron-accent/50 transition-all outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-bron-text-dim">Default AI Model</label>
                <div className="relative">
                  <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bron-text-muted" />
                  <select 
                    value={settings.model}
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    className="w-full bg-bron-surface border border-bron-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-bron-text focus:border-bron-accent/50 transition-all outline-none appearance-none"
                  >
                    {models.length > 0 ? (
                      [...models]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(m => {
                          const pPrompt = Number(m.pricing.prompt) * 1_000_000;
                          const pComp = Number(m.pricing.completion) * 1_000_000;
                          const avg = (pPrompt + pComp) / 2;
                          const priceLabel = avg === 0 ? 'FREE' : `$${avg.toFixed(2)}/1M`;
                          
                          return (
                            <option key={m.id} value={m.id}>
                              {m.name} ({priceLabel})
                            </option>
                          );
                        })
                    ) : (
                      <option value="deepseek/deepseek-chat">deepseek/deepseek-chat</option>
                    )}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Browser Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Globe className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Browser Engine</h3>
            </div>
            
            <div className="ml-2 bg-bron-surface/30 border border-bron-border p-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-bron-bg border border-bron-border">
                    <Shield className="w-4 h-4 text-bron-text-dim" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-bron-text">Stealth Mode</h4>
                    <p className="text-[10px] text-bron-text-dim">Enable headless background automation</p>
                  </div>
                </div>
                <input 
                  type="checkbox"
                  checked={settings.headless}
                  onChange={(e) => setSettings({ ...settings, headless: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-bron-border bg-bron-bg/50 flex items-center justify-between">
          <button 
            onClick={loadSettings}
            className="flex items-center gap-2 text-[11px] font-bold text-bron-text-dim hover:text-bron-text transition-colors uppercase tracking-widest"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          
          <button 
            onClick={handleSave}
            disabled={loading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg active:scale-95 ${
              saved 
                ? 'bg-green-500 text-white shadow-green-500/20' 
                : 'bg-bron-accent text-white shadow-bron-accent/20 hover:bg-bron-accent-hover'
            }`}
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;