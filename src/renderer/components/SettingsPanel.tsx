import React, { useEffect, useState, useCallback } from 'react';
import { X, Settings, Cpu, Globe, Key, Shield, Save, Check, RefreshCw, DollarSign, Puzzle, Trash2, Plus, ContactRound } from 'lucide-react';
import type { ModelInfo, BrowserExtensionRecord, SavedCredentialRecord, AutofillProfileRecord, WorkflowRecord, WorkflowScheduleRecord } from '../../shared/types';

interface Props {
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({ onClose }) => {
  const [settings, setSettings] = useState<Record<string, any>>({
    apiKey: '',
    model: 'google/gemini-2.0-pro-exp-02-05:free',
    headless: false,
    agentFullAccess: true,
    agentToolHints: true,
    agentPromptEnhancement: true,
    autoSaveSignIns: true,
    workflowSchedulerEnabled: true,
    syncAccountName: 'Local Browser',
    syncPassphrase: '',
    syncBundlePath: '',
    domainProfiles: '{}',
    theme: 'dark',
    maxSteps: 0,
    maxRuntimeMinutes: 0,
    costGuardMaxCostPerTask: 1.0,
    costGuardMaxCostPerDay: 10.0,
    costGuardMaxRequestsPerMinute: 30,
    costGuardMaxConsecutiveErrors: 5,
    costGuardCooldownMs: 60000,
  });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [extensions, setExtensions] = useState<BrowserExtensionRecord[]>([]);
  const [credentials, setCredentials] = useState<SavedCredentialRecord[]>([]);
  const [autofillProfiles, setAutofillProfiles] = useState<AutofillProfileRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [workflowSchedules, setWorkflowSchedules] = useState<WorkflowScheduleRecord[]>([]);
  const [credentialDraft, setCredentialDraft] = useState({ domain: '', username: '', password: '', notes: '' });
  const [autofillDraft, setAutofillDraft] = useState({
    label: 'Default',
    full_name: '',
    email: '',
    phone: '',
    company: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
  });
  const [workflowDraft, setWorkflowDraft] = useState({
    title: '',
    task_prompt: '',
    notes: '',
    rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
  });
  const [editingWorkflowId, setEditingWorkflowId] = useState<number | null>(null);
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
      const [s, m, exts, creds, profiles, savedWorkflows, savedSchedules] = await Promise.all([
        window.bronAPI.getSettings().catch(e => { console.error('getSettings error:', e); return null; }),
        window.bronAPI.getModels().catch(e => { console.error('getModels error:', e); return []; }),
        window.bronAPI.getBrowserExtensions().catch(e => { console.error('getBrowserExtensions error:', e); return []; }),
        window.bronAPI.getSavedCredentials().catch(e => { console.error('getSavedCredentials error:', e); return []; }),
        window.bronAPI.getAutofillProfiles().catch(e => { console.error('getAutofillProfiles error:', e); return []; }),
        window.bronAPI.getWorkflows().catch(e => { console.error('getWorkflows error:', e); return []; }),
        window.bronAPI.getWorkflowSchedules().catch(e => { console.error('getWorkflowSchedules error:', e); return []; }),
      ]);
      if (s) {
        setSettings({
          apiKey: s.apiKey || '',
          model: s.model || 'google/gemma-2-9b-it',
          headless: !!s.headless,
          agentFullAccess: s.agentFullAccess !== false,
          agentToolHints: s.agentToolHints !== false,
          agentPromptEnhancement: s.agentPromptEnhancement !== false,
          autoSaveSignIns: s.autoSaveSignIns !== false,
          workflowSchedulerEnabled: s.workflowSchedulerEnabled !== false,
          syncAccountName: s.syncAccountName || 'Local Browser',
          syncPassphrase: s.syncPassphrase || '',
          syncBundlePath: s.syncBundlePath || '',
          domainProfiles: s.domainProfiles || '{}',
          theme: s.theme || 'dark',
          maxSteps: typeof s.maxSteps === 'number' ? s.maxSteps : 0,
          maxRuntimeMinutes: typeof s.maxRuntimeMinutes === 'number' ? s.maxRuntimeMinutes : 0,
          costGuardMaxCostPerTask: typeof s.costGuardMaxCostPerTask === 'number' ? s.costGuardMaxCostPerTask : 1.0,
          costGuardMaxCostPerDay: typeof s.costGuardMaxCostPerDay === 'number' ? s.costGuardMaxCostPerDay : 10.0,
          costGuardMaxRequestsPerMinute: typeof s.costGuardMaxRequestsPerMinute === 'number' ? s.costGuardMaxRequestsPerMinute : 30,
          costGuardMaxConsecutiveErrors: typeof s.costGuardMaxConsecutiveErrors === 'number' ? s.costGuardMaxConsecutiveErrors : 5,
          costGuardCooldownMs: typeof s.costGuardCooldownMs === 'number' ? s.costGuardCooldownMs : 60000,
        });
        if (s.apiKey) fetchCredits(s.apiKey);
      }
      setModels(m || []);
      setExtensions(exts || []);
      setCredentials(creds || []);
      setAutofillProfiles(profiles || []);
      setWorkflows(savedWorkflows || []);
      setWorkflowSchedules(savedSchedules || []);
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

  const refreshBrowserCoreData = useCallback(async () => {
    if (!window.bronAPI) return;
    try {
      const [exts, creds, profiles, savedWorkflows, savedSchedules] = await Promise.all([
        window.bronAPI.getBrowserExtensions().catch(e => { console.error('getBrowserExtensions error:', e); return []; }),
        window.bronAPI.getSavedCredentials().catch(e => { console.error('getSavedCredentials error:', e); return []; }),
        window.bronAPI.getAutofillProfiles().catch(e => { console.error('getAutofillProfiles error:', e); return []; }),
        window.bronAPI.getWorkflows().catch(e => { console.error('getWorkflows error:', e); return []; }),
        window.bronAPI.getWorkflowSchedules().catch(e => { console.error('getWorkflowSchedules error:', e); return []; }),
      ]);
      setExtensions(exts || []);
      setCredentials(creds || []);
      setAutofillProfiles(profiles || []);
      setWorkflows(savedWorkflows || []);
      setWorkflowSchedules(savedSchedules || []);
    } catch (e) {
      console.error('Failed to refresh browser core data:', e);
    }
  }, []);

  const handleAddExtension = async () => {
    if (!window.bronAPI) return;
    const sourcePath = await window.bronAPI.pickExtensionDirectory();
    if (!sourcePath) return;
    setLoading(true);
    try {
      await window.bronAPI.saveBrowserExtension({ source_path: sourcePath, enabled: true });
      await refreshBrowserCoreData();
    } catch (e) {
      console.error('Failed to add extension:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExtension = async (record: BrowserExtensionRecord) => {
    if (!window.bronAPI) return;
    await window.bronAPI.saveBrowserExtension({ ...record, enabled: !record.enabled });
    await refreshBrowserCoreData();
  };

  const handleDeleteExtension = async (id: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.deleteBrowserExtension(id);
    await refreshBrowserCoreData();
  };

  const handleSaveCredential = async () => {
    if (!window.bronAPI || !credentialDraft.domain.trim()) return;
    await window.bronAPI.saveSavedCredential(credentialDraft);
    setCredentialDraft({ domain: '', username: '', password: '', notes: '' });
    await refreshBrowserCoreData();
  };

  const handleDeleteCredential = async (id: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.deleteSavedCredential(id);
    await refreshBrowserCoreData();
  };

  const handleSaveAutofillProfile = async () => {
    if (!window.bronAPI || !autofillDraft.label.trim()) return;
    await window.bronAPI.saveAutofillProfile(autofillDraft);
    setAutofillDraft({
      label: 'Default',
      full_name: '',
      email: '',
      phone: '',
      company: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
    });
    await refreshBrowserCoreData();
  };

  const handleDeleteAutofillProfile = async (id: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.deleteAutofillProfile(id);
    await refreshBrowserCoreData();
  };

  const handleSaveWorkflow = async () => {
    if (!window.bronAPI || !workflowDraft.title.trim() || !workflowDraft.task_prompt.trim()) return;
    const existingSchedule = editingWorkflowId ? workflowSchedules.find((entry) => entry.workflow_id === editingWorkflowId) : undefined;
    const workflowId = await window.bronAPI.saveWorkflow({
      id: editingWorkflowId || undefined,
      title: workflowDraft.title,
      task_prompt: workflowDraft.task_prompt,
      notes: workflowDraft.notes,
    });
    if (workflowDraft.rrule.trim()) {
      await window.bronAPI.saveWorkflowSchedule({
        id: existingSchedule?.id,
        workflow_id: workflowId,
        rrule: workflowDraft.rrule.trim(),
        enabled: existingSchedule?.enabled ?? true,
      });
    } else if (existingSchedule?.id) {
      await window.bronAPI.deleteWorkflowSchedule(existingSchedule.id);
    }
    setEditingWorkflowId(null);
    setWorkflowDraft({
      title: '',
      task_prompt: '',
      notes: '',
      rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
    });
    await refreshBrowserCoreData();
  };

  const handleDeleteWorkflow = async (id: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.deleteWorkflow(id);
    if (editingWorkflowId === id) {
      setEditingWorkflowId(null);
      setWorkflowDraft({
        title: '',
        task_prompt: '',
        notes: '',
        rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
      });
    }
    await refreshBrowserCoreData();
  };

  const handleEditWorkflow = (workflow: WorkflowRecord, schedule?: WorkflowScheduleRecord) => {
    setEditingWorkflowId(workflow.id);
    setWorkflowDraft({
      title: workflow.title,
      task_prompt: workflow.task_prompt,
      notes: workflow.notes || '',
      rrule: schedule?.rrule || '',
    });
  };

  const handleRunWorkflow = async (id: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.runWorkflowNow(id);
  };

  const handleToggleWorkflowSchedule = async (workflowId: number, schedule?: WorkflowScheduleRecord) => {
    if (!window.bronAPI) return;
    if (!schedule) {
      const workflow = workflows.find((entry) => entry.id === workflowId);
      if (!workflow) return;
      await window.bronAPI.saveWorkflowSchedule({
        workflow_id: workflowId,
        rrule: workflowDraft.rrule.trim() || 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
        enabled: true,
      });
    } else {
      await window.bronAPI.saveWorkflowSchedule({
        id: schedule.id,
        workflow_id: schedule.workflow_id,
        rrule: schedule.rrule,
        enabled: !schedule.enabled,
        next_run_at: schedule.next_run_at,
        last_run_at: schedule.last_run_at,
      });
    }
    await refreshBrowserCoreData();
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
                    <h4 className="text-sm font-bold text-bron-text">Live Browser Engine</h4>
                    <p className="text-[10px] text-bron-text-dim">Unified browser control is active. The old mirrored headless engine is no longer part of normal runtime behavior.</p>
                  </div>
                </div>
                <input 
                  type="checkbox"
                  checked={settings.headless}
                  disabled
                  onChange={(e) => setSettings({ ...settings, headless: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-not-allowed opacity-60"
                />
              </div>
            </div>

            <div className="ml-2 bg-bron-surface/30 border border-bron-border p-4 rounded-2xl space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Full Agent Access</h4>
                  <p className="text-[10px] text-bron-text-dim">Let the agent use browser, file, history, bookmark, download, and connected app tools without asking again.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.agentFullAccess}
                  onChange={(e) => setSettings({ ...settings, agentFullAccess: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Runtime Tool Hints</h4>
                  <p className="text-[10px] text-bron-text-dim">Remind the agent of the active tool catalog, automation engine, paths, and limits on every run.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.agentToolHints}
                  onChange={(e) => setSettings({ ...settings, agentToolHints: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Prompt Optimizer</h4>
                  <p className="text-[10px] text-bron-text-dim">Use ChatGPT 5.1 engine to automatically analyze, optimize, and detail prompts for maximum execution accuracy.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.agentPromptEnhancement}
                  onChange={(e) => setSettings({ ...settings, agentPromptEnhancement: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Auto-save Sign-ins</h4>
                  <p className="text-[10px] text-bron-text-dim">Remember successful logins detected in the browser so repeat tasks get faster.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoSaveSignIns}
                  onChange={(e) => setSettings({ ...settings, autoSaveSignIns: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Workflow Scheduler</h4>
                  <p className="text-[10px] text-bron-text-dim">Let saved workflows run automatically on their schedule in this browser.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.workflowSchedulerEnabled}
                  onChange={(e) => setSettings({ ...settings, workflowSchedulerEnabled: e.target.checked })}
                  className="w-5 h-5 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div>
                  <h4 className="text-sm font-bold text-bron-text">Domain Profiles</h4>
                  <p className="text-[10px] text-bron-text-dim">Optional per-site JSON hints for the agent, like login or workflow notes by domain.</p>
                </div>
                <textarea
                  value={settings.domainProfiles || '{}'}
                  onChange={(e) => setSettings({ ...settings, domainProfiles: e.target.value })}
                  rows={5}
                  placeholder='{"web.whatsapp.com":"Use row context buttons for delete/archive. Avoid repeated left-click loops.","docs.google.com":"Prefer visible text targets over brittle selectors."}'
                  className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-xs text-bron-text outline-none resize-y font-mono"
                />
              </div>
            </div>
          </section>

          {/* Performance & Safety Limits Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Cpu className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Performance & Safety Limits</h3>
            </div>

            <div className="ml-2 bg-bron-surface/30 border border-bron-border p-5 rounded-2xl space-y-6">
              {/* Max Steps Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-sm font-bold text-bron-text">Max Steps per Task</h4>
                    <p className="text-[10px] text-bron-text-dim">Maximum number of actions allowed per execution session.</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-bron-accent/20 border border-bron-accent/30 text-xs font-black text-bron-accent">
                    {settings.maxSteps === 0 ? 'Unlimited (0)' : `${settings.maxSteps} steps`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  step="5"
                  value={settings.maxSteps || 0}
                  onChange={(e) => setSettings({ ...settings, maxSteps: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-bron-bg border border-bron-border rounded-lg appearance-none cursor-pointer accent-bron-accent"
                />
              </div>

              {/* Max Runtime Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-sm font-bold text-bron-text">Max Task Duration</h4>
                    <p className="text-[10px] text-bron-text-dim">Maximum execution runtime before automatic graceful stop.</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-bron-accent/20 border border-bron-accent/30 text-xs font-black text-bron-accent">
                    {settings.maxRuntimeMinutes === 0 ? 'Unlimited (0)' : `${settings.maxRuntimeMinutes} mins`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="2"
                  value={settings.maxRuntimeMinutes || 0}
                  onChange={(e) => setSettings({ ...settings, maxRuntimeMinutes: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-bron-bg border border-bron-border rounded-lg appearance-none cursor-pointer accent-bron-accent"
                />
              </div>

              {/* Cost Guard Segments */}
              <div className="border-t border-bron-border/50 pt-4 space-y-4">
                <div className="flex items-center gap-2 mb-2 text-bron-text-dim">
                  <Shield className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Cost Guard & Circuit Breaker</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-bron-text-dim uppercase tracking-wider">Max Cost / Task</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-bold text-bron-text-dim">$</span>
                      <input
                        type="number"
                        step="0.05"
                        min="0.01"
                        value={settings.costGuardMaxCostPerTask || 1.0}
                        onChange={(e) => setSettings({ ...settings, costGuardMaxCostPerTask: parseFloat(e.target.value) || 1.0 })}
                        className="w-full bg-bron-bg border border-bron-border rounded-xl pl-6 pr-3 py-2 text-xs text-bron-text font-bold outline-none focus:border-bron-accent"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-bron-text-dim uppercase tracking-wider">Max Cost / Day</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-bold text-bron-text-dim">$</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        value={settings.costGuardMaxCostPerDay || 10.0}
                        onChange={(e) => setSettings({ ...settings, costGuardMaxCostPerDay: parseFloat(e.target.value) || 10.0 })}
                        className="w-full bg-bron-bg border border-bron-border rounded-xl pl-6 pr-3 py-2 text-xs text-bron-text font-bold outline-none focus:border-bron-accent"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-bron-text-dim uppercase tracking-wider">Max Requests / Min</label>
                    <input
                      type="number"
                      min="5"
                      max="120"
                      value={settings.costGuardMaxRequestsPerMinute || 30}
                      onChange={(e) => setSettings({ ...settings, costGuardMaxRequestsPerMinute: parseInt(e.target.value, 10) || 30 })}
                      className="w-full bg-bron-bg border border-bron-border rounded-xl px-3 py-2 text-xs text-bron-text font-bold outline-none focus:border-bron-accent"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-bron-text-dim uppercase tracking-wider">
                      Consecutive Errors {settings.costGuardMaxConsecutiveErrors === 0 ? '(Unlimited)' : ''}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={settings.costGuardMaxConsecutiveErrors === undefined ? 5 : settings.costGuardMaxConsecutiveErrors}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setSettings({ ...settings, costGuardMaxConsecutiveErrors: isNaN(val) ? 5 : val });
                      }}
                      className="w-full bg-bron-bg border border-bron-border rounded-xl px-3 py-2 text-xs text-bron-text font-bold outline-none focus:border-bron-accent"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Globe className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Account & Sync</h3>
            </div>

            <div className="ml-2 bg-bron-surface/20 border border-bron-border rounded-2xl p-4 space-y-3">
              <input
                value={settings.syncAccountName || ''}
                onChange={(e) => setSettings({ ...settings, syncAccountName: e.target.value })}
                placeholder="Account name"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <input
                value={settings.syncPassphrase || ''}
                onChange={(e) => setSettings({ ...settings, syncPassphrase: e.target.value })}
                placeholder="Sync passphrase"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <div className="text-[10px] text-bron-text-dim">
                Sync bundle path: {settings.syncBundlePath || 'Not chosen yet'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.bronAPI) return;
                    await handleSave();
                    const result = await window.bronAPI.exportSyncBundle();
                    if (!result.saved && result.reason) {
                      alert(result.reason);
                    } else if (result.saved && result.path) {
                      alert(`Sync bundle saved to:\n${result.path}`);
                    }
                    await loadSettings();
                  }}
                  className="px-4 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold"
                >
                  Export Sync Bundle
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.bronAPI) return;
                    await handleSave();
                    const result = await window.bronAPI.importSyncBundle();
                    if (!result.imported && result.reason) {
                      alert(result.reason);
                    } else if (result.imported) {
                      alert('Sync bundle imported successfully.');
                    }
                    await loadSettings();
                    await refreshBrowserCoreData();
                  }}
                  className="px-4 py-2 rounded-xl bg-bron-surface border border-bron-border text-bron-text text-xs font-bold"
                >
                  Import Sync Bundle
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-bron-accent">
              <div className="flex items-center gap-2">
                <Puzzle className="w-4 h-4" />
                <h3 className="text-xs font-extrabold uppercase tracking-widest">Extensions</h3>
              </div>
              <button
                type="button"
                onClick={handleAddExtension}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text hover:border-bron-accent/40"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Unpacked
              </button>
            </div>

            <div className="space-y-3 ml-2">
              {extensions.length === 0 ? (
                <div className="bg-bron-surface/20 border border-bron-border rounded-2xl p-4 text-[11px] text-bron-text-dim">
                  No extensions installed yet. Add an unpacked Chromium extension folder to load it into persistent browser profiles.
                </div>
              ) : extensions.map((extension) => (
                <div key={extension.id} className="bg-bron-surface/20 border border-bron-border rounded-2xl p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-bron-text">{extension.name || 'Unnamed extension'}</div>
                    <div className="text-[10px] text-bron-text-dim mt-1 break-all">{extension.source_path}</div>
                    <div className="text-[10px] text-bron-text-dim mt-1">
                      {extension.version ? `v${extension.version}` : 'Version unknown'}
                      {extension.extension_id ? ` - ${extension.extension_id}` : ''}
                    </div>
                    {extension.last_error && (
                      <div className="text-[10px] text-red-400 mt-2">{extension.last_error}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-[10px] text-bron-text-dim flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={extension.enabled}
                        onChange={() => handleToggleExtension(extension)}
                        className="w-4 h-4 rounded-md border-bron-border bg-bron-surface text-bron-accent focus:ring-bron-accent/20 cursor-pointer"
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDeleteExtension(extension.id)}
                      className="p-2 rounded-xl border border-bron-border hover:border-red-400/40 text-bron-text-dim hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Key className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Passwords & Autofill</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 ml-2">
              <div className="bg-bron-surface/20 border border-bron-border rounded-2xl p-4 space-y-3">
                <div className="text-sm font-bold text-bron-text">Saved Sign-ins</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={credentialDraft.domain}
                    onChange={(e) => setCredentialDraft({ ...credentialDraft, domain: e.target.value })}
                    placeholder="Site domain"
                    className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
                  />
                  <input
                    value={credentialDraft.username}
                    onChange={(e) => setCredentialDraft({ ...credentialDraft, username: e.target.value })}
                    placeholder="Username or email"
                    className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
                  />
                  <input
                    type="password"
                    value={credentialDraft.password}
                    onChange={(e) => setCredentialDraft({ ...credentialDraft, password: e.target.value })}
                    placeholder="Password"
                    className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
                  />
                  <input
                    value={credentialDraft.notes}
                    onChange={(e) => setCredentialDraft({ ...credentialDraft, notes: e.target.value })}
                    placeholder="Notes"
                    className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveCredential}
                  className="px-4 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold"
                >
                  Save Sign-in
                </button>

                <div className="space-y-2">
                  {credentials.length === 0 ? (
                    <div className="text-[11px] text-bron-text-dim">No saved sign-ins yet.</div>
                  ) : credentials.map((credential) => (
                    <div key={credential.id} className="flex items-center justify-between gap-4 bg-bron-bg/40 border border-bron-border rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bron-text">{credential.domain}</div>
                        <div className="text-[10px] text-bron-text-dim">{credential.username || 'No username saved'}{credential.notes ? ` - ${credential.notes}` : ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCredential(credential.id)}
                        className="p-2 rounded-lg text-bron-text-dim hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-bron-surface/20 border border-bron-border rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-bron-text">
                  <ContactRound className="w-4 h-4" />
                  <div className="text-sm font-bold">Autofill Profiles</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={autofillDraft.label} onChange={(e) => setAutofillDraft({ ...autofillDraft, label: e.target.value })} placeholder="Profile label" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.full_name} onChange={(e) => setAutofillDraft({ ...autofillDraft, full_name: e.target.value })} placeholder="Full name" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.email} onChange={(e) => setAutofillDraft({ ...autofillDraft, email: e.target.value })} placeholder="Email" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.phone} onChange={(e) => setAutofillDraft({ ...autofillDraft, phone: e.target.value })} placeholder="Phone" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.company} onChange={(e) => setAutofillDraft({ ...autofillDraft, company: e.target.value })} placeholder="Company" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.address_line1} onChange={(e) => setAutofillDraft({ ...autofillDraft, address_line1: e.target.value })} placeholder="Address line 1" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.address_line2} onChange={(e) => setAutofillDraft({ ...autofillDraft, address_line2: e.target.value })} placeholder="Address line 2" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.city} onChange={(e) => setAutofillDraft({ ...autofillDraft, city: e.target.value })} placeholder="City" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.state} onChange={(e) => setAutofillDraft({ ...autofillDraft, state: e.target.value })} placeholder="State" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.postal_code} onChange={(e) => setAutofillDraft({ ...autofillDraft, postal_code: e.target.value })} placeholder="Postal code" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                  <input value={autofillDraft.country} onChange={(e) => setAutofillDraft({ ...autofillDraft, country: e.target.value })} placeholder="Country" className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none" />
                </div>
                <button
                  type="button"
                  onClick={handleSaveAutofillProfile}
                  className="px-4 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold"
                >
                  Save Profile
                </button>

                <div className="space-y-2">
                  {autofillProfiles.length === 0 ? (
                    <div className="text-[11px] text-bron-text-dim">No autofill profiles yet.</div>
                  ) : autofillProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-center justify-between gap-4 bg-bron-bg/40 border border-bron-border rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bron-text">{profile.label}</div>
                        <div className="text-[10px] text-bron-text-dim">{profile.full_name || 'No name'}{profile.email ? ` - ${profile.email}` : ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAutofillProfile(profile.id)}
                        className="p-2 rounded-lg text-bron-text-dim hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-bron-accent">
              <Globe className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-widest">Workflows & Schedules</h3>
            </div>

            <div className="ml-2 bg-bron-surface/20 border border-bron-border rounded-2xl p-4 space-y-3">
              <input
                value={workflowDraft.title}
                onChange={(e) => setWorkflowDraft({ ...workflowDraft, title: e.target.value })}
                placeholder="Workflow title"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <textarea
                value={workflowDraft.task_prompt}
                onChange={(e) => setWorkflowDraft({ ...workflowDraft, task_prompt: e.target.value })}
                placeholder="What should this workflow do?"
                rows={4}
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none resize-y"
              />
              <input
                value={workflowDraft.notes}
                onChange={(e) => setWorkflowDraft({ ...workflowDraft, notes: e.target.value })}
                placeholder="Notes"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <input
                value={workflowDraft.rrule}
                onChange={(e) => setWorkflowDraft({ ...workflowDraft, rrule: e.target.value })}
                placeholder="RRULE, for example FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <button
                type="button"
                onClick={handleSaveWorkflow}
                className="px-4 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold"
              >
                {editingWorkflowId ? 'Update Workflow' : 'Save Workflow'}
              </button>
              {editingWorkflowId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorkflowId(null);
                    setWorkflowDraft({
                      title: '',
                      task_prompt: '',
                      notes: '',
                      rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
                    });
                  }}
                  className="ml-2 px-4 py-2 rounded-xl bg-bron-surface border border-bron-border text-bron-text text-xs font-bold"
                >
                  Cancel Edit
                </button>
              )}

              <div className="space-y-2">
                {workflows.length === 0 ? (
                  <div className="text-[11px] text-bron-text-dim">No workflows saved yet.</div>
                ) : workflows.map((workflow) => {
                  const schedule = workflowSchedules.find((entry) => entry.workflow_id === workflow.id);
                  return (
                    <div key={workflow.id} className="flex items-start justify-between gap-4 bg-bron-bg/40 border border-bron-border rounded-xl px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bron-text">{workflow.title}</div>
                        <div className="text-[10px] text-bron-text-dim mt-1 whitespace-pre-wrap">{workflow.task_prompt}</div>
                        {workflow.notes && (
                          <div className="text-[10px] text-bron-text-dim mt-1">{workflow.notes}</div>
                        )}
                        {schedule && (
                          <div className="text-[10px] text-bron-text-dim mt-2">
                            {schedule.enabled ? 'Active' : 'Paused'} - {schedule.rrule}
                            {schedule.next_run_at ? ` - next ${schedule.next_run_at}` : ''}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRunWorkflow(workflow.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text"
                        >
                          Run now
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditWorkflow(workflow, schedule)}
                          className="px-2.5 py-1.5 rounded-lg bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleWorkflowSchedule(workflow.id, schedule)}
                          className="px-2.5 py-1.5 rounded-lg bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text"
                        >
                          {schedule ? (schedule.enabled ? 'Pause' : 'Resume') : 'Add schedule'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          className="p-2 rounded-lg text-bron-text-dim hover:text-red-400 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
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
