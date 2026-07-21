import type {
  EditedFileCategory,
  EditedFileChangeKind,
  EditedFileEntry,
  FileEditToolCallRecord,
} from './types';

export type {
  EditedFileCategory,
  EditedFileChangeKind,
  EditedFileEntry,
  FileEditToolCallRecord,
} from './types';

/*
 * ── Source constants ────────────────────────────────────────────────────────
 * The scanner recognizes three edit-producing sources. Their identifiers /
 * apiNames / state shapes are replicated here as literals (NOT imported) so
 * builtin-tools gains no dependency on `@lobechat/builtin-tool-cloud-sandbox`,
 * `@lobechat/tool-runtime`, or `@lobechat/heterogeneous-agents`. Keep in sync
 * with those upstream sources:
 */

/**
 * Built-in cloud sandbox tool.
 * Source: `@lobechat/builtin-tool-cloud-sandbox` `CloudSandboxIdentifier` +
 * `CloudSandboxApiName`. States: `@lobechat/tool-runtime` `WriteFileState`
 * (`{ path, success }`), `EditFileState` (`{ path, diffText?, linesAdded?,
 * linesDeleted? }`), `MoveFilesState` (`{ results: [{ source?, destination?,
 * success }] }`).
 */
const CLOUD_SANDBOX_IDENTIFIER = 'lobe-cloud-sandbox';
const SANDBOX_WRITE_FILE_API = 'writeFile';
const SANDBOX_EDIT_FILE_API = 'editFile';
const SANDBOX_MOVE_FILES_API = 'moveFiles';

/**
 * Codex heterogeneous agent.
 * Source: `@lobechat/heterogeneous-agents` `adapters/codex.ts` — `toToolPayload`
 * stamps every Codex tool call with `identifier = 'codex'` (`CODEX_IDENTIFIER`)
 * and `synthesizeFileChangePluginState` produces apiName `file_change`, state
 * shape `{ changes: [{ path, kind, diffText?, linesAdded, linesDeleted }] }`
 * where `kind` is the RAW Codex kind (`add` / `delete` / `remove` / `rename` /
 * other). Both fields are persisted to `message_plugins`, so the scanner gates
 * on the identifier too (see `extractRecordOps`) — apiName alone would let any
 * third-party plugin that happens to name a tool `file_change` slip in.
 */
const CODEX_IDENTIFIER = 'codex';
const CODEX_FILE_CHANGE_API = 'file_change';

/**
 * Claude Code heterogeneous agent.
 * Source: `@lobechat/heterogeneous-agents` `adapters/claudeCode.ts` — the
 * `tool_use` mapping stamps `identifier = 'claude-code'`
 * (`CLAUDE_CODE_IDENTIFIER`), `apiName = block.name`, and
 * `arguments = JSON.stringify(input)`. The file-editing tools all carry a single
 * `file_path` argument (MultiEdit too: one `file_path`, many `edits`). No
 * line/diff data is surfaced. Gated on the identifier as well as the apiName so
 * an unrelated plugin exposing an `Edit`/`Write`/`MultiEdit` tool can't slip in.
 */
const CLAUDE_CODE_IDENTIFIER = 'claude-code';
const CLAUDE_CODE_EDIT_APIS = new Set(['Edit', 'Write', 'MultiEdit']);

// ── Structural helpers ───────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trim surrounding whitespace; preserve case. Returns undefined for empty. */
const normalizePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Coerce an untrusted value into a finite non-NaN number, else 0. */
const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Parse the raw JSON `arguments` string; tolerate objects and malformed input. */
const parseArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A tool call whose `state` explicitly reports failure is skipped wholesale.
 * `success === false` (write / kill / …) or a non-empty `error` marks a failed
 * call. Batch tools (moveFiles) carry NO top-level `success`/`error` — their
 * per-item `success` gates each result instead, so they are never rejected here.
 */
const isFailedState = (state: unknown): boolean => {
  if (!isRecord(state)) return false;
  if (state.success === false) return true;
  const error = state.error;
  return error != null && error !== '';
};

// ── Normalized edit ops (pre-fold) ───────────────────────────────────────────

interface EditOpBase {
  diffText?: string;
  linesAdded: number;
  linesDeleted: number;
  toolCallId: string;
}

/** A write with ambiguous create-vs-overwrite semantics (sandbox writeFile / CC Write). */
interface WriteOp extends EditOpBase {
  path: string;
  type: 'write';
}

/** A change carrying an already-resolved terminal-ish kind (no known rename source). */
interface ChangeOp extends EditOpBase {
  kind: EditedFileChangeKind;
  path: string;
  type: 'change';
}

/** A rename with a known source → destination (sandbox moveFiles). */
interface RenameOp extends EditOpBase {
  destination: string;
  source: string;
  type: 'rename';
}

type EditOp = ChangeOp | RenameOp | WriteOp;

const emptyDeltas = (
  record: Record<string, unknown> | undefined,
): Pick<EditOpBase, 'diffText' | 'linesAdded' | 'linesDeleted'> => ({
  diffText: record ? nonEmptyString(record.diffText) : undefined,
  linesAdded: toNumber(record?.linesAdded),
  linesDeleted: toNumber(record?.linesDeleted),
});

// ── Per-source extraction ────────────────────────────────────────────────────

const extractSandboxOps = (record: FileEditToolCallRecord): EditOp[] => {
  const state = isRecord(record.state) ? record.state : undefined;
  const { toolCallId } = record;

  // Parse the raw `arguments` JSON lazily: only writeFile/editFile fall back to
  // it, and only when the resolved `state.path` is missing. Skipping the parse
  // on the common (state carries the path) path avoids a JSON.parse per record.
  const pathFromArgs = (): string | undefined =>
    normalizePath(parseArguments(record.arguments)?.path);

  switch (record.apiName) {
    case SANDBOX_WRITE_FILE_API: {
      const path = normalizePath(state?.path) ?? pathFromArgs();
      if (!path) return [];
      return [{ linesAdded: 0, linesDeleted: 0, path, toolCallId, type: 'write' }];
    }
    case SANDBOX_EDIT_FILE_API: {
      const path = normalizePath(state?.path) ?? pathFromArgs();
      if (!path) return [];
      return [{ ...emptyDeltas(state), kind: 'modified', path, toolCallId, type: 'change' }];
    }
    case SANDBOX_MOVE_FILES_API: {
      const results = Array.isArray(state?.results) ? state.results : [];
      return results.flatMap((entry): RenameOp[] => {
        if (!isRecord(entry) || entry.success !== true) return [];
        const source = normalizePath(entry.source);
        const destination = normalizePath(entry.destination);
        if (!source || !destination) return [];
        return [
          { destination, linesAdded: 0, linesDeleted: 0, source, toolCallId, type: 'rename' },
        ];
      });
    }
    default: {
      return [];
    }
  }
};

/** Map a RAW Codex file-change kind onto our terminal kind (mirrors codex adapter). */
const codexKindToChangeKind = (kind: unknown): EditedFileChangeKind => {
  switch (kind) {
    case 'add': {
      return 'added';
    }
    case 'delete':
    case 'remove': {
      return 'deleted';
    }
    case 'rename': {
      return 'renamed';
    }
    default: {
      return 'modified';
    }
  }
};

const extractCodexOps = (record: FileEditToolCallRecord): EditOp[] => {
  const state = isRecord(record.state) ? record.state : undefined;
  const changes = Array.isArray(state?.changes) ? state.changes : [];
  const { toolCallId } = record;

  return changes.flatMap((change): ChangeOp[] => {
    if (!isRecord(change)) return [];
    const path = normalizePath(change.path);
    if (!path) return [];
    // Codex renames carry only a single `path` (no source), so a renamed entry
    // records the new path with `previousPath` left undefined.
    return [
      {
        ...emptyDeltas(change),
        kind: codexKindToChangeKind(change.kind),
        path,
        toolCallId,
        type: 'change',
      },
    ];
  });
};

const extractClaudeCodeOps = (record: FileEditToolCallRecord): EditOp[] => {
  const args = parseArguments(record.arguments);
  const path = normalizePath(args?.file_path);
  if (!path) return [];
  // CC edit tools surface no line/diff data — record the touch with 0 deltas.
  // Write is create-or-overwrite (ambiguous), Edit/MultiEdit always modify.
  if (record.apiName === 'Write') {
    return [{ linesAdded: 0, linesDeleted: 0, path, toolCallId: record.toolCallId, type: 'write' }];
  }
  return [
    {
      kind: 'modified',
      linesAdded: 0,
      linesDeleted: 0,
      path,
      toolCallId: record.toolCallId,
      type: 'change',
    },
  ];
};

const extractRecordOps = (record: FileEditToolCallRecord): EditOp[] => {
  // A plugin-level error means the edit never landed (server:
  // `message_plugins.error`; client: `tool.result?.error`) — skip the record
  // wholesale, same as an explicit `state` failure below.
  if (record.error != null && record.error !== '') return [];
  if (isFailedState(record.state)) return [];

  // Gate each source on its identifier (all three are persisted to
  // `message_plugins.identifier`), not apiName alone: an unrelated third-party
  // plugin naming a tool `file_change` / `Edit` / `Write` must never be treated
  // as an editing tool.
  if (record.identifier === CLOUD_SANDBOX_IDENTIFIER) return extractSandboxOps(record);
  if (record.identifier === CODEX_IDENTIFIER && record.apiName === CODEX_FILE_CHANGE_API) {
    return extractCodexOps(record);
  }
  if (record.identifier === CLAUDE_CODE_IDENTIFIER && CLAUDE_CODE_EDIT_APIS.has(record.apiName)) {
    return extractClaudeCodeOps(record);
  }

  // runCommand / command_execution / Bash / any other apiName — the accepted
  // blind spot (sed/bash edits are not tracked).
  return [];
};

// ── Terminal-state folding ───────────────────────────────────────────────────

interface MutableEntry {
  diffTexts: string[];
  kind: EditedFileChangeKind;
  linesAdded: number;
  linesDeleted: number;
  path: string;
  previousPath?: string;
  sourceToolCallIds: string[];
}

const newEntry = (path: string, kind: EditedFileChangeKind): MutableEntry => ({
  diffTexts: [],
  kind,
  linesAdded: 0,
  linesDeleted: 0,
  path,
  sourceToolCallIds: [],
});

const accumulate = (entry: MutableEntry, op: EditOpBase): void => {
  entry.linesAdded += op.linesAdded;
  entry.linesDeleted += op.linesDeleted;
  if (op.diffText) entry.diffTexts.push(op.diffText);
  entry.sourceToolCallIds.push(op.toolCallId);
};

/**
 * Fold a forward (add / modify / rename-without-source) kind onto the running
 * terminal kind. Order-sensitive per the brief:
 * - `added` is sticky (added → modified stays `added`; the file is net-new).
 * - `renamed` is sticky against later modifies (edits follow the new path).
 * - a re-touch after `deleted` is a net MODIFY: an added→deleted pair is dropped
 *   wholesale in {@link applyDelete}, so a `deleted` running kind here always
 *   means a file that pre-existed the operation and was re-created, i.e. its
 *   content changed rather than being net-new.
 * - otherwise the running kind settles to `modified`.
 */
const foldForwardKind = (
  prev: EditedFileChangeKind,
  next: 'added' | 'modified' | 'renamed',
): EditedFileChangeKind => {
  if (next === 'renamed') return prev === 'added' ? 'added' : 'renamed';
  if (prev === 'renamed') return 'renamed';
  if (prev === 'added') return 'added';
  if (prev === 'deleted') return 'modified';
  return 'modified';
};

const applyDelete = (map: Map<string, MutableEntry>, op: ChangeOp): void => {
  const existing = map.get(op.path);
  // added → deleted within one operation is a net no-op: drop it entirely.
  if (existing?.kind === 'added') {
    map.delete(op.path);
    return;
  }
  if (existing) {
    existing.kind = 'deleted';
    accumulate(existing, op);
    return;
  }
  const entry = newEntry(op.path, 'deleted');
  accumulate(entry, op);
  map.set(op.path, entry);
};

const applyForward = (map: Map<string, MutableEntry>, op: WriteOp | ChangeOp): void => {
  const incoming: 'added' | 'modified' | 'renamed' =
    op.type === 'write' ? 'modified' : (op.kind as 'added' | 'modified' | 'renamed');
  const existing = map.get(op.path);

  if (!existing) {
    // A first-seen write is `added`; otherwise adopt the incoming kind.
    const entry = newEntry(op.path, op.type === 'write' ? 'added' : op.kind);
    accumulate(entry, op);
    map.set(op.path, entry);
    return;
  }

  existing.kind = foldForwardKind(existing.kind, incoming);
  accumulate(existing, op);
};

const applyRename = (map: Map<string, MutableEntry>, op: RenameOp): void => {
  const existing = map.get(op.source);

  if (existing) {
    map.delete(op.source);
    if (existing.kind === 'added') {
      // A file created earlier this operation and then moved stays net-new at
      // its destination — no `previousPath` (the source never pre-existed).
      existing.path = op.destination;
    } else {
      existing.previousPath = existing.previousPath ?? op.source;
      existing.path = op.destination;
      existing.kind = 'renamed';
    }
    accumulate(existing, op);
    map.set(op.destination, existing);
    return;
  }

  const entry = newEntry(op.destination, 'renamed');
  entry.previousPath = op.source;
  accumulate(entry, op);
  map.set(op.destination, entry);
};

const applyOp = (map: Map<string, MutableEntry>, op: EditOp): void => {
  if (op.type === 'rename') {
    applyRename(map, op);
    return;
  }
  if (op.type === 'change' && op.kind === 'deleted') {
    applyDelete(map, op);
    return;
  }
  applyForward(map, op);
};

/**
 * Scan every persisted tool call of ONE operation and fold them into the
 * terminal set of edited files. Records are processed in the given order (their
 * persisted chronological order), so the folding rules resolve correctly.
 *
 * Malformed `arguments` / `state` never throw — the offending record simply
 * contributes whatever is parseable (often nothing).
 */
export const scanOperationFileEdits = (records: FileEditToolCallRecord[]): EditedFileEntry[] => {
  const map = new Map<string, MutableEntry>();

  for (const record of records) {
    for (const op of extractRecordOps(record)) applyOp(map, op);
  }

  return [...map.values()].map((entry) => ({
    diffTexts: entry.diffTexts,
    kind: entry.kind,
    linesAdded: entry.linesAdded,
    linesDeleted: entry.linesDeleted,
    path: entry.path,
    ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
    sourceToolCallIds: entry.sourceToolCallIds,
  }));
};

// ── Path classification ──────────────────────────────────────────────────────

/** Entity-format extensions that register into the works / work_versions system. */
const ENTITY_EXTENSIONS: Record<string, 'slides' | 'sheet' | 'doc' | 'pdf'> = {
  csv: 'sheet',
  doc: 'doc',
  docx: 'doc',
  pdf: 'pdf',
  ppt: 'slides',
  pptx: 'slides',
  xls: 'sheet',
  xlsx: 'sheet',
};

const HTML_EXTENSIONS = new Set(['htm', 'html']);

/**
 * Basename of a POSIX/Windows path: the last non-empty segment with surrounding
 * whitespace trimmed. Tolerates either separator (`/` or `\`) and a trailing
 * slash; returns '' when the path has no usable segment.
 *
 * Single source of truth for the consumers that used to hand-roll this — the
 * server `fileWorkRegistration`, the `EditedFilesCard` and `Work/descriptors` UI.
 */
export const getBasename = (path: string): string =>
  path.replaceAll('\\', '/').split('/').findLast(Boolean)?.trim() ?? '';

/**
 * Lowercased extension of a path's basename, WITHOUT the leading dot, or '' when
 * there is none. A leading-dot dotfile with no real extension (e.g. `.env`)
 * returns '' — the dot at index 0 is not an extension separator.
 */
export const getFileExtension = (path: string): string => {
  const basename = getBasename(path);
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return basename.slice(dotIndex + 1).toLowerCase();
};

/**
 * Classify an edited file's path so the two consumers can split it: entity
 * documents get a Work, HTML rides the artifact-hosting path, everything else
 * folds into the aggregate "edited N files" card. Case-insensitive.
 */
export const classifyEditedFile = (path: string): EditedFileCategory => {
  const extension = getFileExtension(path);
  const entityKind = ENTITY_EXTENSIONS[extension];
  if (entityKind) return { category: 'entity', entityKind };
  if (HTML_EXTENSIONS.has(extension)) return { category: 'html' };
  return { category: 'other' };
};
