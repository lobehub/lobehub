import type { ReactNode } from 'react';

export type DockTaskStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface DockTaskResult {
  /** Label for the trailing action button; omit for a url-only result. */
  action?: string;
  /** Shown on the strip; a url renders in the code face, anything else muted. */
  label: string;
  onAction?: () => void;
  onCopy?: () => void;
  onOpen?: () => void;
}

export interface DockTask {
  cancel?: () => void;
  detail?: ReactNode;
  /**
   * Removes the task from its producer. The dock calls it when the row is
   * closed, and — for a task with no `result` — once its success has been
   * shown long enough to read.
   */
  dismiss?: () => void;
  /** Producer-supplied action node, rendered after the built-in row actions. */
  extra?: ReactNode;
  /**
   * Cancels every active task this producer owns in one operation. Shared by
   * all of its tasks; the dock calls it once per group rather than walking
   * `cancel` per task, which a producer may implement as a full-list update.
   */
  groupCancel?: () => void;
  /** Translated section heading; tasks sharing one keep their producer order. */
  groupLabel: string;
  icon?: ReactNode;
  id: string;
  /** 0-100. Omit while the task has no measurable progress. */
  progress?: number;
  /**
   * What the finished task leaves behind — a published URL, a stored file.
   * A task with a result stays until the user closes it; one without
   * dissipates on its own.
   */
  result?: DockTaskResult;
  retry?: () => void;
  status: DockTaskStatus;
  title: string;
}

export type DockTaskProvider = () => DockTask[];
