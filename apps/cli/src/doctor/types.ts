/**
 * `lh doctor` — one command that walks the whole chain, from this process up to
 * a real agent round trip, and says which link is broken.
 *
 * Every check is a small, independent unit with an id, a group, the profiles it
 * belongs to, and the checks it cannot run without. The runner owns ordering,
 * skipping and timeouts so a check body only has to answer one question.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

/** Layers of the chain, reported (and rendered) in this order. */
export type CheckGroup =
  'runtime' | 'endpoints' | 'credentials' | 'scope' | 'context' | 'server' | 'device' | 'execution';

export const CHECK_GROUP_ORDER: readonly CheckGroup[] = [
  'runtime',
  'endpoints',
  'credentials',
  'scope',
  'context',
  'server',
  'device',
  'execution',
];

export const CHECK_GROUP_TITLES: Record<CheckGroup, string> = {
  context: 'Run context',
  credentials: 'Credentials',
  device: 'Device gateway',
  endpoints: 'Endpoints',
  execution: 'Execution',
  runtime: 'Runtime',
  scope: 'Workspace scope',
  server: 'Server',
};

/**
 * `core` runs on a bare `lh doctor`: fast, cheap and useful without knowing
 * what you are debugging. The rest are opt-in via `--profile`.
 */
export type SelectableProfile = 'core' | 'connect' | 'agent' | 'hetero' | 'selfhost';
export type DoctorProfile = SelectableProfile | 'all';

export const SELECTABLE_PROFILES: readonly SelectableProfile[] = [
  'core',
  'connect',
  'agent',
  'hetero',
  'selfhost',
];

export const DOCTOR_PROFILES: readonly DoctorProfile[] = [...SELECTABLE_PROFILES, 'all'];

/** What a check body returns. */
export interface CheckOutcome {
  /** One line, the finding itself. */
  detail: string;
  /**
   * Structured facts a script can assert on; never contains secrets.
   *
   * A `repairable` key is the check's signal that THIS finding is one `--fix`
   * can act on, and which one it is: a check that detects several broken states
   * repairs only the state it actually found. Without it the runner leaves the
   * finding alone, so a warning nobody can fix produces no failed-repair noise.
   */
  evidence?: Record<string, unknown> & { repairable?: string };
  /** What the user should do about it. */
  fix?: string;
  /**
   * Why a check excluded itself — a missing `--agent`, an inapplicable
   * platform. Runner-level skips (`--offline`, a failed dependency) set this
   * too, so a caller never has to guess why a check produced no finding.
   */
  skippedBecause?: string;
  status: CheckStatus;
}

export interface CheckResult extends CheckOutcome {
  durationMs: number;
  group: CheckGroup;
  id: string;
  /** Set when `--fix` changed something before this result was produced. */
  repaired?: string;
  title: string;
}

export interface DoctorOptions {
  /** Agent id or slug to check execution readiness against. */
  agent?: string;
  /** Run the expensive / side-effecting checks. */
  deep: boolean;
  /** Apply the repairs the failing checks know how to apply. */
  fix: boolean;
  /** Extra heterogeneous agent types to probe, beyond the defaults. */
  hetero?: string[];
  /** Skip every check that would touch the network. */
  offline: boolean;
  profile: DoctorProfile;
  /** Treat warnings as failures for the exit code. */
  strict: boolean;
  /** Per-check budget for anything that talks to the network. */
  timeoutMs: number;
}

export interface DoctorContext {
  options: DoctorOptions;
  /**
   * Memoized cross-check probe. Several checks read the same server response;
   * the loader for a given key runs at most once per `lh doctor` invocation.
   */
  probe: <T>(key: string, load: () => Promise<T>) => Promise<T>;
  /** An already-produced result, for checks that build on an earlier finding. */
  result: (id: string) => CheckResult | undefined;
}

export interface DoctorCheck {
  /**
   * Time this check may take, when `--timeout` is the wrong budget for it —
   * a check that waits on a model needs minutes where a health probe needs
   * seconds. Defaults to `options.timeoutMs`.
   */
  budgetMs?: (options: DoctorOptions) => number;
  /** Only runs with `--deep`: slow, costly, or it starts a real run. */
  deep?: boolean;
  /** Ids whose failure (or skip) makes this check unrunnable. */
  dependsOn?: readonly string[];
  group: CheckGroup;
  id: string;
  /** Talks to the network — excluded by `--offline`. */
  network?: boolean;
  profiles: readonly SelectableProfile[];
  /**
   * Undo the specific broken state this check detects. Runs only under `--fix`,
   * only when the check did not pass AND reported `evidence.repairable`, and
   * the check is re-run afterwards so the report shows the post-repair truth.
   * Returns what it did.
   */
  repair?: (ctx: DoctorContext, result: CheckResult) => Promise<string> | string;
  run: (ctx: DoctorContext) => Promise<CheckOutcome> | CheckOutcome;
  title: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  cli: { bin: string; version: string };
  generatedAt: string;
  profile: DoctorProfile;
  /** Present when `--fix` ran; one line per attempted repair. */
  repairs?: { action: string; id: string; ok: boolean }[];
  /** Worst status across the checks. */
  status: 'ok' | 'warn' | 'fail';
  summary: Record<CheckStatus, number>;
}
