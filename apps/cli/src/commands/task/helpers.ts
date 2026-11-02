import pc from 'picocolors';

/** Mirrors the server's `TASK_STATUSES`; inlined rather than adding a package dependency. */
export const TASK_STATUSES = [
  'backlog',
  'running',
  'scheduled',
  'paused',
  'completed',
  'failed',
  'canceled',
] as const;

export function statusBadge(status: string): string {
  const pad = (s: string) => s.padEnd(9);
  switch (status) {
    case 'backlog': {
      return pc.dim(`○ ${pad('backlog')}`);
    }
    case 'blocked': {
      return pc.red(`◉ ${pad('blocked')}`);
    }
    case 'running': {
      return pc.blue(`● ${pad('running')}`);
    }
    case 'scheduled': {
      return pc.cyan(`◷ ${pad('scheduled')}`);
    }
    case 'paused': {
      return pc.yellow(`◐ ${pad('paused')}`);
    }
    case 'completed': {
      return pc.green(`✓ ${pad('completed')}`);
    }
    case 'failed': {
      return pc.red(`✗ ${pad('failed')}`);
    }
    case 'timeout': {
      return pc.red(`⏱ ${pad('timeout')}`);
    }
    case 'canceled': {
      return pc.dim(`⊘ ${pad('canceled')}`);
    }
    default: {
      return status;
    }
  }
}

export function briefIcon(type: string): string {
  switch (type) {
    case 'decision': {
      return '📋';
    }
    case 'result': {
      return '✅';
    }
    case 'insight': {
      return '💡';
    }
    case 'error': {
      return '❌';
    }
    default: {
      return '📌';
    }
  }
}

export function priorityLabel(priority: number | null | undefined): string {
  switch (priority) {
    case 1: {
      return pc.red('urgent');
    }
    case 2: {
      return pc.yellow('high');
    }
    case 3: {
      return 'normal';
    }
    case 4: {
      return pc.dim('low');
    }
    default: {
      return pc.dim('-');
    }
  }
}
