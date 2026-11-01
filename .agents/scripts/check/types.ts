/** One extension group of a repo's lint toolchain (mirrors its lint-staged config). */
export interface PipelineEntry {
  exts: string[];
  /** Tools run sequentially on the same file group (fix order matters). */
  tools: string[][];
}

/** A repository participating in the check: the host root or a vendored sub-repo. */
export interface RepoMount {
  /** Base ref used to decide whether a selected file is newly added in this PR. */
  baseRef?: string;
  /** Root-relative directory of the repo; '' means the host repo itself. */
  dir: string;
  pipelines: PipelineEntry[];
}

export interface CheckConfig {
  /** Mounts in routing order; exactly one entry must have `dir: ''` (the host root). */
  repos: RepoMount[];
  /** Absolute path of the host repo root. */
  rootDir: string;
}

export interface LintProblem {
  file: string;
  line: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
}

export interface FileDiff {
  added: number;
  diff: string;
  file: string;
  removed: number;
}

export interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

export interface LintOutcome {
  fatal: string[];
  problems: LintProblem[];
}

export interface TestOutcome {
  failedOutput: string[];
  noMatch: string[];
  passed: number;
}
