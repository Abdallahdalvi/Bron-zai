import type { BrowserWindow } from 'electron';
import type { AgentAutomationController } from './agentAutomation';
import { isAgentRunning, runAgent } from './agent';
import {
  getSettings,
  getWorkflowById,
  getWorkflowSchedules,
  createWorkflowRun,
  markWorkflowRun,
  updateWorkflowScheduleRunState,
} from './memory';

type SchedulerDeps = {
  browserController: AgentAutomationController;
  getWindow: () => BrowserWindow | null;
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerActive = false;
const runningScheduleIds = new Set<number>();

function parseRule(rrule: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of String(rrule || '').split(';')) {
    const [rawKey, rawValue] = part.split('=');
    const key = String(rawKey || '').trim().toUpperCase();
    const value = String(rawValue || '').trim();
    if (key && value) map[key] = value;
  }
  return map;
}

function startOfMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function weekdayCode(date: Date): string {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()];
}

function computeNextRunFromRule(rrule: string, from: Date): Date {
  const rule = parseRule(rrule);
  const freq = String(rule.FREQ || 'DAILY').toUpperCase();
  const interval = Math.max(1, Number(rule.INTERVAL || '1'));
  const byHour = Number(rule.BYHOUR ?? from.getHours());
  const byMinute = Number(rule.BYMINUTE ?? from.getMinutes());
  const base = startOfMinute(new Date(from));

  if (freq === 'HOURLY') {
    const next = new Date(base);
    next.setMinutes(byMinute, 0, 0);
    if (next <= from) {
      next.setHours(next.getHours() + interval);
    }
    return next;
  }

  if (freq === 'WEEKLY') {
    const allowedDays = String(rule.BYDAY || 'MO')
      .split(',')
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean);
    const next = new Date(base);
    next.setHours(byHour, byMinute, 0, 0);
    for (let offset = 0; offset < 14 * interval; offset += 1) {
      const candidate = new Date(next);
      candidate.setDate(next.getDate() + offset);
      if (!allowedDays.includes(weekdayCode(candidate))) continue;
      if (candidate > from) return candidate;
    }
    next.setDate(next.getDate() + 7 * interval);
    return next;
  }

  const next = new Date(base);
  next.setHours(byHour, byMinute, 0, 0);
  if (next <= from) {
    next.setDate(next.getDate() + interval);
  }
  return next;
}

async function tick(deps: SchedulerDeps): Promise<void> {
  if (schedulerActive) return;
  schedulerActive = true;
  try {
    if (getSettings().workflowSchedulerEnabled === false) return;
    const now = new Date();
    const schedules = getWorkflowSchedules().filter((schedule) => schedule.enabled);
    for (const schedule of schedules) {
      if (runningScheduleIds.has(schedule.id)) continue;

      const workflow = getWorkflowById(schedule.workflow_id);
      if (!workflow || !workflow.task_prompt.trim()) continue;

      const nextRun = schedule.next_run_at
        ? new Date(schedule.next_run_at)
        : computeNextRunFromRule(schedule.rrule, now);

      if (!schedule.next_run_at) {
        updateWorkflowScheduleRunState(schedule.id, { next_run_at: nextRun.toISOString() });
      }

      if (Number.isNaN(nextRun.getTime()) || nextRun > now) continue;
      if (isAgentRunning()) continue;
      if (!deps.getWindow()) continue;

      runningScheduleIds.add(schedule.id);
      try {
        const workflowRunId = createWorkflowRun({
          workflow_id: workflow.id,
          origin: 'scheduled',
          task_snapshot: workflow.task_prompt,
        });
        await runAgent(
          {
            task: workflow.task_prompt,
            contextMessages: [
              `Scheduled workflow run: ${workflow.title}`,
              workflow.notes ? `Workflow notes: ${workflow.notes}` : '',
            ].filter(Boolean),
            workflowId: workflow.id,
            workflowRunId,
            workflowOrigin: 'scheduled',
          },
          deps.browserController,
          deps.getWindow,
        );

        const completedAt = new Date();
        const upcoming = computeNextRunFromRule(schedule.rrule, completedAt);
        markWorkflowRun(workflow.id, completedAt.toISOString());
        updateWorkflowScheduleRunState(schedule.id, {
          last_run_at: completedAt.toISOString(),
          next_run_at: upcoming.toISOString(),
        });
      } catch {
        const retryAt = computeNextRunFromRule(schedule.rrule, new Date(now.getTime() + 60_000));
        updateWorkflowScheduleRunState(schedule.id, { next_run_at: retryAt.toISOString() });
      } finally {
        runningScheduleIds.delete(schedule.id);
      }
    }
  } finally {
    schedulerActive = false;
  }
}

export function startWorkflowScheduler(deps: SchedulerDeps): void {
  if (schedulerTimer) return;
  void tick(deps);
  schedulerTimer = setInterval(() => {
    void tick(deps);
  }, 30_000);
}

export function stopWorkflowScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
