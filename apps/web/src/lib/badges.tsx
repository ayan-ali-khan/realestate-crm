// Stage/priority/status chips shared by the leads list, lead detail and tasks.
// Colors are decorative (no semantic meaning beyond at-a-glance scanning), so
// they stay here as a plain map rather than in the theme.
import type { LeadPriority, PipelineStage, TaskStatus } from './types';

const STAGE_STYLES: Record<PipelineStage, string> = {
  NEW_LEAD: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  CONTACTED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  SITE_VISIT: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  NEGOTIATION: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  CLOSED_WON: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CLOSED_LOST: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

const PRIORITY_STYLES: Record<LeadPriority, string> = {
  LOW: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  MEDIUM: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  URGENT: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

const TASK_STYLES: Record<TaskStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  DONE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export function StageBadge({ stage }: { stage: PipelineStage }) {
  return <span className={`${CHIP} ${STAGE_STYLES[stage]}`}>{stage.replace(/_/g, ' ')}</span>;
}

export function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span className={`${CHIP} ${PRIORITY_STYLES[priority]}`}>{priority.replace(/_/g, ' ')}</span>
  );
}

export function TaskStatusBadge({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${CHIP} ${TASK_STYLES[status]}`}>{status.replace(/_/g, ' ')}</span>
      {overdue && status === 'PENDING' && (
        <span className={`${CHIP} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>
          OVERDUE
        </span>
      )}
    </span>
  );
}
