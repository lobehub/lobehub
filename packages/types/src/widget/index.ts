// ============================================
// Widget — scripted, scheduled data cards
// (`widgets` / `widget_versions` / `widget_runs` tables)
// ============================================
//
// A widget's data logic is a script executed in a sandbox. Its stdout must be
// one JSON document matching `WidgetOutput`; the platform owns execution,
// scheduling, versioning and rendering. Widgets are a standalone entity so any
// host surface (a board, a goal, an agent page …) can mount the same widget.

export const WIDGET_VISIBILITIES = ['private', 'public'] as const;
export type WidgetVisibility = (typeof WIDGET_VISIBILITIES)[number];

/**
 * Direct ownership level of a widget, derived from which scope columns are
 * set:
 *
 * - `personal` — no workspace, project or agent
 * - `workspace` — workspace only
 * - `project` — a project (and no agent)
 * - `agent` — an agent, optionally inside a project
 */
export type WidgetLevel = 'personal' | 'workspace' | 'project' | 'agent';

/**
 * Selects one direct level for list queries. The workspace comes from the
 * caller context; omit both ids for the personal / workspace level.
 */
export interface WidgetLevelFilter {
  agentId?: string | null;
  projectId?: string | null;
}

// ── Script contract ─────────────────────────────────────

export const WIDGET_RUNTIMES = ['node', 'python', 'bash'] as const;
export type WidgetRuntime = (typeof WIDGET_RUNTIMES)[number];

export const WIDGET_OUTPUT_TYPES = ['stat', 'list', 'series', 'table'] as const;
export type WidgetOutputType = (typeof WIDGET_OUTPUT_TYPES)[number];

export type WidgetTrend = 'up' | 'down' | 'flat';

/**
 * Optional envelope a script may attach to any output. `complete: false`
 * marks a partial result (e.g. one of several upstream APIs failed): the run
 * finishes as `partial` — the card still renders the output, but the value is
 * not recorded into the widget's metric trend.
 */
export interface WidgetOutputMeta {
  complete?: boolean;
  /** Short human-readable note shown beside a partial result. */
  message?: string;
}

/** A single headline number (or short string) with optional comparison. */
export interface WidgetStatOutput {
  /** Change against the previous period, already formatted or numeric. */
  delta?: number | string;
  description?: string;
  label?: string;
  meta?: WidgetOutputMeta;
  trend?: WidgetTrend;
  type: 'stat';
  unit?: string;
  value: number | string;
}

export interface WidgetListItem {
  description?: string;
  /** Free-form status tag, e.g. 'open', 'failed', 'merged'. */
  status?: string;
  /** ISO timestamp the item refers to. */
  time?: string;
  title: string;
  url?: string;
  value?: number | string;
}

export interface WidgetListOutput {
  items: WidgetListItem[];
  meta?: WidgetOutputMeta;
  type: 'list';
}

export interface WidgetSeriesPoint {
  /** ISO timestamp or category label. */
  t: string;
  v: number;
}

export interface WidgetSeries {
  name: string;
  points: WidgetSeriesPoint[];
}

export interface WidgetSeriesOutput {
  meta?: WidgetOutputMeta;
  series: WidgetSeries[];
  type: 'series';
  unit?: string;
}

export interface WidgetTableColumn {
  key: string;
  title?: string;
  type?: 'string' | 'number' | 'date' | 'link';
}

export type WidgetTableCell = string | number | boolean | null;

export interface WidgetTableOutput {
  columns: WidgetTableColumn[];
  meta?: WidgetOutputMeta;
  rows: Record<string, WidgetTableCell>[];
  type: 'table';
}

/** The JSON document a widget script prints to stdout. */
export type WidgetOutput =
  WidgetStatOutput | WidgetListOutput | WidgetSeriesOutput | WidgetTableOutput;

/** One secret or variable the script expects in its environment. */
export interface WidgetEnvRequirement {
  /**
   * Connector providing the credential, resolved through the user connector
   * chain (agent > workspace > personal), e.g. 'github'.
   */
  connector?: string;
  description?: string;
  /** Environment variable name the script reads, e.g. 'GITHUB_TOKEN'. */
  name: string;
  required?: boolean;
}

/**
 * Declarative contract stored beside the script: what it needs to run and how
 * the platform should treat its output.
 */
export interface WidgetManifest {
  description?: string;
  env?: WidgetEnvRequirement[];
  /**
   * Record numeric output into `metrics` / `metric_points` so the widget gets
   * a long-term trend. `valuePath` picks the number from the output, e.g.
   * 'value' for a stat.
   */
  metric?: {
    key: string;
    kind?: 'gauge' | 'counter';
    unit?: string;
    valuePath?: string;
  };
  /** Hostnames the sandbox may reach; empty or omitted means no network. */
  network?: { allow: string[] };
  /** Suggested refresh schedule applied when the version is published. */
  schedule?: { pattern: string; timezone?: string };
  timeoutMs?: number;
  title?: string;
}

/** Rendering hints for the widget card, independent of the data. */
export interface WidgetView {
  chart?: 'line' | 'bar' | 'area';
  /** Column keys to show, in order, for table output. */
  columns?: string[];
  /** Maximum list / table rows before truncation. */
  limit?: number;
  size?: 'sm' | 'md' | 'lg';
}

// ── Versions ────────────────────────────────────────────

/**
 * - `draft` — authored, not live; at most one is the widget's current draft
 * - `published` — the version scheduled runs execute; one per widget
 * - `archived` — a formerly published version kept for history / rollback
 */
export const WIDGET_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export type WidgetVersionStatus = (typeof WIDGET_VERSION_STATUSES)[number];

/** Who authored a version. */
export const WIDGET_VERSION_SOURCES = ['agent', 'user'] as const;
export type WidgetVersionSource = (typeof WIDGET_VERSION_SOURCES)[number];

// ── Runs ────────────────────────────────────────────────

/**
 * - `preview` — a draft run while authoring; never touches the widget snapshot
 * - `manual` — user pressed refresh
 * - `schedule` — fired by the scheduler from `next_run_at`
 */
export const WIDGET_RUN_TRIGGERS = ['preview', 'manual', 'schedule'] as const;
export type WidgetRunTrigger = (typeof WIDGET_RUN_TRIGGERS)[number];

/**
 * - `running` — opened, the sandbox has not reported back yet
 * - `succeeded` — exit 0 and stdout matched the output contract
 * - `partial` — like `succeeded`, but the output reports
 *   `meta.complete === false`: the card shows it (it becomes the widget's
 *   latest output and resets the failure streak), yet it is not written into
 *   the metric trend
 * - `failed` — non-zero exit, sandbox error or output outside the contract
 * - `timeout` — killed after the manifest's `timeoutMs`
 */
export const WIDGET_RUN_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
  'timeout',
] as const;
export type WidgetRunStatus = (typeof WIDGET_RUN_STATUSES)[number];

export type WidgetRunFinalStatus = Exclude<WidgetRunStatus, 'running'>;

/** Final statuses whose output is usable: the card renders it. */
export const WIDGET_RUN_OUTPUT_STATUSES = [
  'succeeded',
  'partial',
] as const satisfies readonly WidgetRunFinalStatus[];

export interface WidgetRunError {
  /** Machine-readable reason, e.g. 'INVALID_OUTPUT', 'SANDBOX_ERROR', 'NON_ZERO_EXIT'. */
  code: string;
  message: string;
}
