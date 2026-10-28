import type { VerifyEvidenceCapturedBy } from '../verify';

/**
 * The medium of a captured evidence artifact. `audio` covers a delivered or
 * captured sound (TTS output, a recorded voice reply, an alert tone) — it plays
 * inline on the acceptance page instead of publishing as an unplayable blob.
 * `terminal` is one command execution: its payload is the readable text
 * fallback, and {@link VerifyTerminalEvidenceMetadata} under `metadata.terminal`
 * carries the execution facts, provenance and the stdout / stderr / recording
 * artifacts.
 */
export type VerifyEvidenceType =
  | 'screenshot'
  | 'gif'
  | 'video'
  | 'audio'
  | 'text'
  | 'markdown'
  | 'dom_snapshot'
  | 'transcript'
  | 'terminal';

/**
 * Where a terminal evidence's observation came from. A declaration, not an
 * attestation: a `.cast` can be edited and a captured file can be changed
 * before upload, so the label decides eligibility, never authenticity.
 * - captured: recorded by the capturer while the command actually ran
 * - imported: taken from an existing real log, recording or tool result
 * - authored: written by a person or agent — an example, simulation or demo.
 *   It may explain; it never satisfies an execution requirement.
 */
export type VerifyTerminalSourceKind = 'captured' | 'imported' | 'authored';

/**
 * How the observation was obtained. `pipe` keeps stdout and stderr apart,
 * `pty` records one merged terminal stream with real timing, `import` builds
 * the evidence from output that already exists without running anything.
 */
export type VerifyTerminalCaptureMode = 'pipe' | 'pty' | 'import';

/**
 * How the execution ended — kept apart from the upload so a failed command
 * never reads as a successful one because its evidence published fine.
 * `unknown` is the honest answer for imported output that never recorded it.
 */
export type VerifyTerminalOutcome =
  | 'exited'
  | 'signaled'
  | 'timed_out'
  | 'interrupted'
  | 'spawn_failed'
  | 'capture_failed'
  | 'unknown';

/** One file of a terminal evidence, hashed so its upload can be matched to the bundle. */
export interface VerifyTerminalArtifact {
  /** Stored file once uploaded. Absent in a local bundle. */
  fileId?: string;
  /** Bundle-relative file name before upload. Never an absolute local path. */
  path?: string;
  /** Hex SHA-256 of the (redacted) bytes — integrity of transport, not proof of execution. */
  sha256: string;
  size: number;
}

export interface VerifyTerminalTruncation {
  droppedBytes: number;
  keptBytes: number;
  stream: 'cast' | 'output' | 'stderr' | 'stdout';
}

/**
 * The structured half of a `terminal` evidence, stored under
 * `verify_evidence.metadata.terminal`. Unknown facts stay `null` and are named
 * in `processing.missingFields` — an import never infers an exit code from
 * output that "looks successful", and never invents recording timing.
 */
export interface VerifyTerminalEvidenceMetadata {
  artifacts: {
    /** asciicast v3 recording — present only for real recorded timing. */
    cast?: VerifyTerminalArtifact | null;
    /** Merged terminal output with control sequences stripped (pty / import). */
    output?: VerifyTerminalArtifact | null;
    stderr?: VerifyTerminalArtifact | null;
    stdout?: VerifyTerminalArtifact | null;
  };
  capture: {
    /** The tool that produced the bundle, e.g. `{ name: 'lh', version: '0.0.64' }`. */
    capturer?: { name: string; version?: string | null } | null;
    mode: VerifyTerminalCaptureMode;
    /** `separate` keeps stdout / stderr apart; `merged` is one terminal stream. */
    streamLayout: 'merged' | 'separate' | 'unknown';
    /** Terminal size at start (pty / recorded imports). */
    terminal?: { cols: number; rows: number; type?: string | null } | null;
    /** `recorded` only when real event timing exists, i.e. there is a cast to replay. */
    timing: 'recorded' | 'unavailable';
  };
  execution: {
    /** The command as run (redacted). */
    command: string | null;
    cwd: string | null;
    durationMs: number | null;
    /** Allow-listed environment facts (versions, platform) — never the full env. */
    environmentSummary: Record<string, string>;
    /** Why the capture itself failed, when it did. */
    error?: string | null;
    exitCode: number | null;
    finishedAt: string | null;
    outcome: VerifyTerminalOutcome;
    signal: string | null;
    startedAt: string | null;
  };
  processing: {
    /** Fields left unknown, as dotted paths (`execution.exitCode`). */
    missingFields: string[];
    /** Human-readable processing record (derived fields, format normalization). */
    notes: string[];
    /** Which redaction rules fired and how often — never the redacted values. */
    redactions: { count: number; rule: string }[];
    truncation: VerifyTerminalTruncation[];
  };
  source: {
    kind: VerifyTerminalSourceKind;
    /** Where an import came from, e.g. the tool name or log path label. */
    originalRecordRef?: string | null;
    originalTool?: string | null;
  };
  version: 1;
}

/**
 * Declares that a criterion is evidence-driven: it cannot pass on the
 * deliverable text alone — the run must capture and upload an artifact of each
 * listed `type` (via `lh acceptance run result submit`). Stored under the plan item's
 * `verifierConfig.requiredEvidence`, so adding it needs no schema change. The
 * structural gate marks a required item `uncertain` when any listed type is
 * missing, independent of the LLM judge.
 */
export interface RequiredEvidenceSpec {
  /** What the capturer should produce — guidance only, not validated. */
  hint?: string;
  /** Semantic medium the verifier must actually understand, not merely observe exists. */
  modality?: 'audio' | 'document' | 'image' | 'structured' | 'text' | 'video';
  /**
   * `execution`: the requirement asks for a real command run, so only a
   * `terminal` evidence whose source is `captured` or `imported` counts —
   * an authored example never does, whatever its format. Absent means the
   * medium alone is checked.
   */
  provenance?: 'execution';
  /** Where the evidence is expected to come from. */
  scope?: 'deliverable' | 'run_evidence' | 'task_artifacts';
  /** The evidence medium that must be present for this criterion. */
  type: VerifyEvidenceType;
}

/**
 * One evidence artifact produced while judging a check. Carries existence +
 * provenance only — no verdict logic. Verifying an evidence is itself a new
 * check (related through `verify_check_results`), so this table stays flat.
 *
 * The payload lives in exactly one of three places: `content` for small inline
 * text, `documentId` for a LobeHub document, or `fileId` for a stored artifact.
 */
export interface VerifyEvidence {
  capturedAt?: Date | null;
  /** Who produced this artifact. */
  capturedBy?: VerifyEvidenceCapturedBy | null;
  /** The check result this evidence backs. */
  checkResultId: string;
  /** Inline payload for small text evidence (dom snapshot / console log / transcript). */
  content?: string | null;
  createdAt: Date;
  /** Human-readable caption, e.g. "首页首屏完整渲染". */
  description?: string | null;
  /** LobeHub document evidence — FK to `documents`. */
  documentId?: string | null;
  /** Stored artifact — FK to `files`, which owns mime / size / hash / url. */
  fileId?: string | null;
  id: string;
  /** Generic extension bag; concrete capturer-specific shape is not fixed yet. */
  metadata?: unknown | null;
  type: VerifyEvidenceType;
}

// ============================================
// Report — the LLM-generated delivery-verification narrative for a run
// ============================================
