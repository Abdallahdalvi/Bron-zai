import React, { useEffect, useMemo, useState } from 'react';
import { X, Clock3, Play, RefreshCw, Trash2, Plus, CheckCircle2, AlertTriangle, PauseCircle, Activity } from 'lucide-react';
import type { WorkflowRecord, WorkflowRunRecord, WorkflowScheduleRecord } from '../../shared/types';

interface Props {
  onClose: () => void;
}

const DEFAULT_RRULE = 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0';

const WorkflowsPanel: React.FC<Props> = ({ onClose }) => {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [schedules, setSchedules] = useState<WorkflowScheduleRecord[]>([]);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({
    id: 0,
    title: '',
    task_prompt: '',
    notes: '',
    rrule: DEFAULT_RRULE,
  });

  const selectedWorkflow = useMemo(
    () => workflows.find((entry) => entry.id === selectedWorkflowId) || workflows[0] || null,
    [selectedWorkflowId, workflows],
  );

  const load = async () => {
    if (!window.bronAPI) return;
    setLoading(true);
    try {
      const [nextWorkflows, nextSchedules] = await Promise.all([
        window.bronAPI.getWorkflows(),
        window.bronAPI.getWorkflowSchedules(),
      ]);
      setWorkflows(nextWorkflows || []);
      setSchedules(nextSchedules || []);
      const fallbackId = selectedWorkflowId || nextWorkflows?.[0]?.id || null;
      setSelectedWorkflowId(fallbackId);
      if (fallbackId) {
        const nextRuns = await window.bronAPI.getWorkflowRuns(fallbackId);
        setRuns(nextRuns || []);
      } else {
        setRuns([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!window.bronAPI || !selectedWorkflowId) return;
    void window.bronAPI.getWorkflowRuns(selectedWorkflowId).then((nextRuns) => {
      setRuns(nextRuns || []);
    }).catch(() => {});
  }, [selectedWorkflowId]);

  const currentSchedule = selectedWorkflow
    ? schedules.find((entry) => entry.workflow_id === selectedWorkflow.id)
    : undefined;

  const resetDraft = () => {
    setDraft({
      id: 0,
      title: '',
      task_prompt: '',
      notes: '',
      rrule: DEFAULT_RRULE,
    });
  };

  const handleSave = async () => {
    if (!window.bronAPI || !draft.title.trim() || !draft.task_prompt.trim()) return;
    const workflowId = await window.bronAPI.saveWorkflow({
      id: draft.id || undefined,
      title: draft.title,
      task_prompt: draft.task_prompt,
      notes: draft.notes,
    });
    if (draft.rrule.trim()) {
      const existingSchedule = schedules.find((entry) => entry.workflow_id === workflowId);
      await window.bronAPI.saveWorkflowSchedule({
        id: existingSchedule?.id,
        workflow_id: workflowId,
        rrule: draft.rrule.trim(),
        enabled: existingSchedule?.enabled ?? true,
        next_run_at: existingSchedule?.next_run_at,
        last_run_at: existingSchedule?.last_run_at,
      });
    }
    setSelectedWorkflowId(workflowId);
    resetDraft();
    await load();
  };

  const handleRunNow = async (workflowId: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.runWorkflowNow(workflowId);
    setSelectedWorkflowId(workflowId);
    await load();
  };

  const handleEdit = (workflow: WorkflowRecord) => {
    const schedule = schedules.find((entry) => entry.workflow_id === workflow.id);
    setDraft({
      id: workflow.id,
      title: workflow.title,
      task_prompt: workflow.task_prompt,
      notes: workflow.notes || '',
      rrule: schedule?.rrule || DEFAULT_RRULE,
    });
  };

  const handleDelete = async (workflowId: number) => {
    if (!window.bronAPI) return;
    await window.bronAPI.deleteWorkflow(workflowId);
    if (selectedWorkflowId === workflowId) {
      setSelectedWorkflowId(null);
      setRuns([]);
    }
    if (draft.id === workflowId) {
      resetDraft();
    }
    await load();
  };

  const handleToggleSchedule = async (workflowId: number) => {
    if (!window.bronAPI) return;
    const schedule = schedules.find((entry) => entry.workflow_id === workflowId);
    if (!schedule) return;
    await window.bronAPI.saveWorkflowSchedule({
      id: schedule.id,
      workflow_id: schedule.workflow_id,
      rrule: schedule.rrule,
      enabled: !schedule.enabled,
      next_run_at: schedule.next_run_at,
      last_run_at: schedule.last_run_at,
    });
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-bron-panel border border-bron-border w-full max-w-6xl rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="px-6 py-5 border-b border-bron-border flex items-center justify-between bg-bron-bg/50">
          <div>
            <h2 className="text-lg font-bold text-bron-text">Workflows</h2>
            <p className="text-[10px] text-bron-text-dim uppercase font-bold tracking-widest">Saved tasks, schedules, and run history</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bron-surface transition-colors text-bron-text-dim">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-[320px,1fr] min-h-[620px] max-h-[80vh]">
          <div className="border-r border-bron-border p-4 space-y-3 overflow-y-auto">
            <div className="bg-bron-surface/20 border border-bron-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-bron-accent">
                <Plus className="w-4 h-4" />
                <div className="text-xs font-extrabold uppercase tracking-widest">{draft.id ? 'Edit workflow' : 'New workflow'}</div>
              </div>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Workflow title"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <textarea
                value={draft.task_prompt}
                onChange={(e) => setDraft({ ...draft, task_prompt: e.target.value })}
                rows={5}
                placeholder="What should this workflow do?"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none resize-y"
              />
              <input
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Notes"
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <input
                value={draft.rrule}
                onChange={(e) => setDraft({ ...draft, rrule: e.target.value })}
                placeholder={DEFAULT_RRULE}
                className="w-full bg-bron-surface border border-bron-border rounded-xl px-3 py-2.5 text-sm text-bron-text outline-none"
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSave} className="px-4 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold">
                  {draft.id ? 'Update' : 'Save'}
                </button>
                {draft.id ? (
                  <button type="button" onClick={resetDraft} className="px-4 py-2 rounded-xl bg-bron-surface border border-bron-border text-bron-text text-xs font-bold">
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              {workflows.map((workflow) => {
                const schedule = schedules.find((entry) => entry.workflow_id === workflow.id);
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => setSelectedWorkflowId(workflow.id)}
                    className={`w-full text-left rounded-2xl border px-3 py-3 transition-colors ${
                      selectedWorkflow?.id === workflow.id
                        ? 'border-bron-accent/40 bg-bron-accent/10'
                        : 'border-bron-border bg-bron-surface/20 hover:bg-bron-surface/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bron-text truncate">{workflow.title}</div>
                        <div className="text-[10px] text-bron-text-dim mt-1 line-clamp-3">{workflow.task_prompt}</div>
                      </div>
                      {schedule?.enabled ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <PauseCircle className="w-4 h-4 text-amber-400 shrink-0" />}
                    </div>
                    {schedule ? (
                      <div className="text-[10px] text-bron-text-dim mt-2">{schedule.rrule}</div>
                    ) : null}
                  </button>
                );
              })}
              {!loading && workflows.length === 0 ? (
                <div className="text-[11px] text-bron-text-dim px-2 py-4">No workflows yet.</div>
              ) : null}
            </div>
          </div>

          <div className="p-5 overflow-y-auto">
            {selectedWorkflow ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-bron-text">{selectedWorkflow.title}</h3>
                    <div className="text-sm text-bron-text-dim mt-2 whitespace-pre-wrap">{selectedWorkflow.task_prompt}</div>
                    {selectedWorkflow.notes ? (
                      <div className="text-[11px] text-bron-text-dim mt-2">{selectedWorkflow.notes}</div>
                    ) : null}
                    {currentSchedule ? (
                      <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text-dim">
                        <Clock3 className="w-3 h-3" />
                        {currentSchedule.enabled ? 'Scheduled' : 'Paused'} - {currentSchedule.rrule}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => handleRunNow(selectedWorkflow.id)} className="px-3 py-2 rounded-xl bg-bron-accent text-white text-xs font-bold flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5" />
                      Run now
                    </button>
                    <button type="button" onClick={() => handleEdit(selectedWorkflow)} className="px-3 py-2 rounded-xl bg-bron-surface border border-bron-border text-bron-text text-xs font-bold">
                      Edit
                    </button>
                    {currentSchedule ? (
                      <button type="button" onClick={() => handleToggleSchedule(selectedWorkflow.id)} className="px-3 py-2 rounded-xl bg-bron-surface border border-bron-border text-bron-text text-xs font-bold">
                        {currentSchedule.enabled ? 'Pause' : 'Resume'}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => handleDelete(selectedWorkflow.id)} className="p-2 rounded-xl text-bron-text-dim hover:text-red-400 border border-bron-border bg-bron-surface">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="border border-bron-border rounded-2xl bg-bron-surface/20 overflow-hidden">
                  <div className="px-4 py-3 border-b border-bron-border flex items-center justify-between">
                    <div className="flex items-center gap-2 text-bron-accent">
                      <Activity className="w-4 h-4" />
                      <div className="text-xs font-extrabold uppercase tracking-widest">Run History</div>
                    </div>
                    <button type="button" onClick={() => load()} className="text-[10px] font-bold text-bron-text-dim flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  </div>
                  <div className="divide-y divide-bron-border/60">
                    {runs.length === 0 ? (
                      <div className="px-4 py-6 text-[11px] text-bron-text-dim">No runs yet for this workflow.</div>
                    ) : runs.map((run) => (
                      <div key={run.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-bron-text flex items-center gap-2">
                              {run.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : run.status === 'failed' ? <AlertTriangle className="w-4 h-4 text-red-400" /> : run.status === 'stopped' ? <PauseCircle className="w-4 h-4 text-amber-400" /> : <RefreshCw className="w-4 h-4 text-bron-accent animate-spin" />}
                              {run.origin} run
                            </div>
                            <div className="text-[10px] text-bron-text-dim mt-1">
                              {run.started_at}
                              {run.ended_at ? ` - ended ${run.ended_at}` : ''}
                              {run.step_count ? ` - ${run.step_count} steps` : ''}
                            </div>
                            <div className="text-[11px] text-bron-text-dim mt-2 whitespace-pre-wrap">
                              {run.result_summary || run.error_message || run.task_snapshot}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRunNow(run.workflow_id)}
                            className="px-2.5 py-1.5 rounded-lg bg-bron-surface border border-bron-border text-[10px] font-bold text-bron-text shrink-0"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-bron-text-dim text-sm">Pick a workflow to inspect its history.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowsPanel;
