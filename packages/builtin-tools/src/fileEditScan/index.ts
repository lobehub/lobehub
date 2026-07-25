import { CloudSandboxApiName, CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { SkillsApiName, SkillsIdentifier } from '@lobechat/builtin-tool-skills';

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
 * The scanner recognizes two kinds of edit-producing sources: STRUCTURED ones
 * (cloud-sandbox + local-system writeFile/editFile/moveFiles, codex
 * file_change, claude-code Edit/Write/MultiEdit) plus HETERO-SHELL command-text
 * scanning (lobe-local-system runCommand, claude-code Bash, codex
 * command_execution, device-routed lobe-skills runCommand/execScript) —
 * see `extractShellCommandOps`. Built-in tool identifiers / apiNames use their
 * packages' canonical exported contracts; heterogeneous-agent names remain
 * local because those packages are intentionally not dependencies here.
 */

/**
 * Built-in cloud sandbox tool.
 * Source: `@lobechat/builtin-tool-cloud-sandbox` `CloudSandboxIdentifier` +
 * `CloudSandboxApiName`. States: `@lobechat/tool-runtime` `WriteFileState`
 * (`{ path, success }`), `EditFileState` (`{ path, diffText?, linesAdded?,
 * linesDeleted? }`), `MoveFilesState` (`{ results: [{ source?, destination?,
 * success }] }`).
 *
 * The local-system tool (`@lobechat/builtin-tool-local-system`) exposes the
 * SAME three file apiNames backed by the same `@lobechat/tool-runtime` states
 * (its runtime is `LocalSystemExecutionRuntime`), so both identifiers share
 * one structured extraction — see `STRUCTURED_FILE_APIS` in
 * `extractRecordOps`. The only difference is downstream: local-system files
 * live on the user's device, so they never register as Works (server
 * registration and the client card both key on the sandbox identifier).
 */
export const CLOUD_SANDBOX_IDENTIFIER = CloudSandboxIdentifier;

type StructuredFileApiKind = 'edit' | 'move' | 'write';

const CLOUD_SANDBOX_FILE_APIS = new Map<string, StructuredFileApiKind>([
  [CloudSandboxApiName.writeFile, 'write'],
  [CloudSandboxApiName.editFile, 'edit'],
  [CloudSandboxApiName.moveFiles, 'move'],
]);
const LOCAL_SYSTEM_FILE_APIS = new Map<string, StructuredFileApiKind>([
  [LocalSystemApiName.writeFile, 'write'],
  [LocalSystemApiName.editFile, 'edit'],
  [LocalSystemApiName.moveFiles, 'move'],
]);

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

/**
 * Hetero-shell command sources — the tools whose raw command text is scanned for
 * entity-document write markers (see `extractShellCommandOps`). Each carries the
 * command in its `arguments` JSON as `{ command: string }`.
 *
 * - lobe-local-system runCommand. Source: `@lobechat/builtin-tool-local-system`
 *   `LocalSystemIdentifier` + `LocalSystemApiName.runCommand`; state
 *   `@lobechat/tool-runtime` `RunCommandState` (`{ exitCode?, success, … }`).
 * - claude-code Bash. Source: `@lobechat/heterogeneous-agents`
 *   `transcript/claudeCode.ts` `CLAUDE_CODE_IDENTIFIER` + tool name `Bash`;
 *   failures surface via the tool-result `error` (is_error), not a state field.
 * - codex command_execution. Source: `@lobechat/heterogeneous-agents`
 *   `adapters/codex.ts` `CODEX_IDENTIFIER` + `CODEX_COMMAND_API`; state pluginState
 *   carries `{ exitCode?, success, … }`.
 *
 * - lobe-skills runCommand / execScript, DEVICE rows only. Source:
 *   `@lobechat/builtin-tool-skills` — both APIs carry the shell text in
 *   `arguments.command` (execScript's script body shares the field name), and
 *   the server runtime stamps `state.executionEnv: 'device' | 'sandbox'` on
 *   every persisted result. Only `executionEnv === 'device'` rows are scanned:
 *   a device-run skill behaves exactly like lobe-local-system runCommand (the
 *   file lands on the user's device). Sandbox rows stay excluded for the same
 *   reason as sandbox runCommand below, and rows missing the field (legacy
 *   data) are ambiguous — excluded to preserve the heuristic's precision.
 *
 * Deliberately NOT in scope: `lobe-cloud-sandbox` runCommand and SANDBOX-side
 * `lobe-skills` rows (sandbox delivery is covered by `exportFile` registration;
 * un-exported sandbox shell output is usually intermediate). Skill-produced
 * deliverables are still captured: a successful `lobe-skills` exportFile row is
 * a registration source in the server's file-work registration, alongside the
 * sandbox tool's exportFile.
 */
const CLAUDE_CODE_BASH_API = 'Bash';
const CODEX_COMMAND_API = 'command_execution';
const SKILLS_SHELL_APIS = new Set([SkillsApiName.runCommand, SkillsApiName.execScript]);

// ── Structural helpers ───────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lexically normalize a POSIX-style path so equivalent spellings dedupe to one
 * key: collapse `.` segments and runs of duplicate/leading/trailing slashes
 * (except the root `/`). Deliberately conservative and pure (no `node:path`, so
 * this stays browser-safe like the rest of this package):
 * - `..` is NOT collapsed — lexical `..` folding is wrong across symlinks, and
 *   the goal is only to canonicalize obviously-equivalent spellings.
 * - relative paths stay relative (never made absolute), symlinks are not
 *   resolved, and a leading `~` (home) survives as its own segment.
 * Case is preserved. Windows separators are out of scope (sandbox paths are
 * POSIX). Examples: `/workspace/./report.pdf` → `/workspace/report.pdf`;
 * `./x` and `x` both → `x`.
 */
export const normalizeScanPath = (path: string): string => {
  const isAbsolute = path.startsWith('/');
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  const joined = segments.join('/');
  if (isAbsolute) return `/${joined}`;
  // Everything collapsed away (e.g. `.` or `./`) → the current directory.
  return joined || '.';
};

/**
 * Trim surrounding whitespace and lexically normalize the path (see
 * {@link normalizeScanPath}) so equivalent spellings key to the same entry;
 * preserve case. Returns undefined for empty.
 */
const normalizePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? normalizeScanPath(trimmed) : undefined;
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

/**
 * A shell tool call whose state reports a non-zero exit code failed — the
 * command's output (and any file it would have written) never landed. Only
 * `RunCommandState` (lobe-local-system) and the codex `command_execution`
 * pluginState carry an `exitCode`; the other structured sources never set it,
 * so this generic guard only fires for the hetero-shell branch.
 */
const hasNonZeroExitCode = (state: unknown): boolean =>
  isRecord(state) && typeof state.exitCode === 'number' && state.exitCode !== 0;

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

/** Structured writeFile / editFile / moveFiles extraction, shared by the
 *  cloud-sandbox and local-system tools (identical apiNames + state shapes). */
const extractStructuredFileOps = (
  record: FileEditToolCallRecord,
  apiKind: StructuredFileApiKind,
): EditOp[] => {
  const state = isRecord(record.state) ? record.state : undefined;
  const { toolCallId } = record;

  // Parse the raw `arguments` JSON lazily: only writeFile/editFile fall back to
  // it, and only when the resolved `state.path` is missing. Skipping the parse
  // on the common (state carries the path) path avoids a JSON.parse per record.
  const pathFromArgs = (): string | undefined =>
    normalizePath(parseArguments(record.arguments)?.path);

  switch (apiKind) {
    case 'write': {
      const path = normalizePath(state?.path) ?? pathFromArgs();
      if (!path) return [];
      return [{ linesAdded: 0, linesDeleted: 0, path, toolCallId, type: 'write' }];
    }
    case 'edit': {
      const path = normalizePath(state?.path) ?? pathFromArgs();
      if (!path) return [];
      return [{ ...emptyDeltas(state), kind: 'modified', path, toolCallId, type: 'change' }];
    }
    case 'move': {
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

// ── Hetero-shell command-text scanning ───────────────────────────────────────
/*
 * Shell commands (runCommand / Bash / command_execution) produce documents two
 * ways in production: ~77% via INLINE script bodies (heredoc / `python -c`) whose
 * output path literal sits inside the command string (`doc.save('/work/x.docx')`)
 * and ~23% via CLI output flags (`marp -o deck.pptx`, `soffice --convert-to`).
 * ~44% of document-mentioning commands are pure READS (pdftotext, unzip -p, …),
 * so bare extension matching is forbidden — only WRITE-context matches count, and
 * we further keep ONLY entity-format paths to bound the heuristic's blast radius
 * (a false positive shows a nonexistent file as "edited"). Precision over recall.
 */

/** Skip Rule A output-flag extraction for downloader commands — `curl -o out.pdf`
 *  / `wget -O` write a DOWNLOAD, not an authored document, and downloads must not
 *  count. Command-level (over-approximates: a downloader anywhere in the string
 *  disables `-o`/`--output` for the whole command), which is the accepted cost. */
const DOWNLOADER_RE = /\b(?:curl|wget|invoke-webrequest)\b/i;

/** Also skip `-o`/`--output` when the command runs a CLI whose `-o` does NOT
 *  name an output file — `grep -o 'report.pdf' notes.txt` (only-matching),
 *  `ps -o`, `tar -o`, `unzip -o` (overwrite) — so the flag's operand is never
 *  mistaken for an authored document. Same command-level over-approximation as
 *  the downloader rule. `sort -o out.csv` is deliberately NOT here: its `-o`
 *  IS an output file. */
const READ_ONLY_O_FLAG_RE = /\b(?:grep|egrep|fgrep|rg|ag|ack|ps|tar|unzip)\b/i;

/**
 * Split a command into whitespace-separated tokens, honoring single/double
 * quotes (quoted spans never split and their quotes are stripped). Good enough
 * for locating `-o`/`--output`/redirect/`--convert-to` markers; it is NOT a full
 * shell parser (no escapes, no `$()`), which is fine for this heuristic.
 */
const tokenizeCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: "'" | '"' | undefined;

  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
};

/** Replace a basename's extension with `ext` (append when it has none). */
const replaceExtension = (basename: string, ext: string): string => {
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  return `${stem}.${ext}`;
};

/**
 * Derive `soffice` / `libreoffice --convert-to <fmt>` output paths: each input
 * file's basename with its extension replaced by the target format (filter
 * suffixes like `pdf:writer_pdf_Export` collapse to `pdf`), joined under
 * `--outdir` when present.
 */
const extractSofficeConvertPaths = (tokens: string[]): string[] => {
  const sofficeIdx = tokens.findIndex((t) => {
    const bin = getBasename(t).toLowerCase();
    return bin === 'soffice' || bin === 'libreoffice';
  });
  if (sofficeIdx === -1) return [];

  let format: string | undefined;
  let outdir: string | undefined;
  const inputs: string[] = [];

  for (let i = sofficeIdx + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    // A shell control operator ends the soffice invocation — without this,
    // `… report.docx && echo done` would derive bogus `&&.pdf` / `echo.pdf`
    // outputs from the tokens of the NEXT command in the pipeline.
    if (/^(?:&&?|\|\|?|;)$/.test(token)) break;
    // Redirect plumbing is not an input document — without this, `2>/dev/null`
    // / `> convert.log` / `2>&1` would derive bogus `null.pdf` / `convert.pdf`
    // / `2>&1.pdf` outputs. A bare operator (`>`, `>>`, `2>`, `<`) also
    // swallows its target token.
    if (/^\d*(?:>>?|<)/.test(token)) {
      if (/^\d*(?:>>?|<)$/.test(token)) i += 1;
      continue;
    }
    if (token === '--convert-to') {
      format = tokens[i + 1];
      i += 1;
    } else if (token.startsWith('--convert-to=')) {
      format = token.slice('--convert-to='.length);
    } else if (token === '--outdir') {
      outdir = tokens[i + 1];
      i += 1;
    } else if (token.startsWith('--outdir=')) {
      outdir = token.slice('--outdir='.length);
    } else if (!token.startsWith('-')) {
      // Positional argument → an input document to convert.
      inputs.push(token);
    }
    // Any other `--flag` (e.g. --headless) is valueless — ignored.
  }

  const fmt = format?.split(':')[0].trim().toLowerCase();
  if (!fmt) return [];

  return inputs.map((input) => {
    const derived = replaceExtension(getBasename(input), fmt);
    return outdir ? `${outdir.replace(/\/+$/, '')}/${derived}` : derived;
  });
};

/** Rule A — CLI output markers (tokenized): `-o`/`--output`, shell redirects,
 *  and `soffice --convert-to` derivations. Returns raw (unfiltered) candidates. */
const extractCliOutputPaths = (command: string): string[] => {
  const tokens = tokenizeCommand(command);
  const skipOutputFlags = DOWNLOADER_RE.test(command) || READ_ONLY_O_FLAG_RE.test(command);
  const paths: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    // Rule A.1 — `-o <path>` / `--output <path>` / `--output=<path>`.
    if (!skipOutputFlags) {
      if (token === '-o' || token === '--output') {
        if (tokens[i + 1]) paths.push(tokens[i + 1]);
        continue;
      }
      if (token.startsWith('--output=')) {
        paths.push(token.slice('--output='.length));
        continue;
      }
    }

    // Rule A.2 — shell redirect `>` / `>>` (bare or attached `>path`). Ignore fd
    // redirects (`2>`, `&>`, `2>&1`, `>&1`): those never start with a plain `>`
    // followed by a filename char.
    if (token === '>' || token === '>>') {
      if (tokens[i + 1]) paths.push(tokens[i + 1]);
    } else if (/^>>?[^&>]/.test(token)) {
      paths.push(token.replace(/^>>?/, ''));
    }
  }

  paths.push(...extractSofficeConvertPaths(tokens));
  return paths;
};

/**
 * Rule B — inline write-call literals, matched over the RAW command text (no
 * tokenization). Each pattern captures the first quoted string argument of a
 * known document-writing call; group 2 is the path literal. READ calls
 * (`load_workbook`, `pdftotext`, …) are deliberately absent.
 */
const INLINE_WRITE_PATTERNS: readonly RegExp[] = [
  // python-pptx / python-docx / openpyxl `.save('…')`
  /\.save\(\s*(['"])([^'"]+)\1/g,
  // pandas `.to_excel('…')` / `.to_csv('…')`
  /\bto_excel\(\s*(['"])([^'"]+)\1/g,
  /\bto_csv\(\s*(['"])([^'"]+)\1/g,
  // weasyprint `.write_pdf('…')`
  /\bwrite_pdf\(\s*(['"])([^'"]+)\1/g,
  // reportlab `Canvas('…')` / `SimpleDocTemplate('…')`
  /\bCanvas\(\s*(['"])([^'"]+)\1/g,
  /\bSimpleDocTemplate\(\s*(['"])([^'"]+)\1/g,
  // pptxgenjs `writeFile({ fileName: '…' })`
  /\bwriteFile\(\s*\{[^}]*?\bfileName\s*:\s*(['"])([^'"]+)\1/g,
];

/** Rule B extraction. Returns raw (unfiltered) path candidates. */
const extractInlineWritePaths = (command: string): string[] => {
  // Un-escape shell-escaped quotes (`\"` → `"`) so a wrapped inline script — e.g.
  // codex's `zsh -c "node -e '…writeFile({ fileName: \"deck.pptx\" })'"` — exposes
  // its quoted literals to the simple quote-delimited patterns below.
  const text = command.replaceAll(/\\(["'])/g, '$1');
  const paths: string[] = [];
  for (const pattern of INLINE_WRITE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match[2]) paths.push(match[2]);
    }
  }
  return paths;
};

/**
 * Scan a hetero-shell command's text for entity-document write markers (Rules A
 * + B). Emits one `modified` ChangeOp per distinct ENTITY path (zero line
 * deltas), mirroring how exportFile-derived entries are synthesized server-side.
 * Non-entity write positions (html/md/txt/ts/…) are never emitted.
 */
const extractShellCommandOps = (record: FileEditToolCallRecord): EditOp[] => {
  const command = parseArguments(record.arguments)?.command;
  if (typeof command !== 'string' || command.trim().length === 0) return [];

  const seen = new Set<string>();
  const ops: ChangeOp[] = [];
  for (const candidate of [
    ...extractCliOutputPaths(command),
    ...extractInlineWritePaths(command),
  ]) {
    const path = normalizePath(candidate);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    // Heuristic branch: keep ONLY entity documents (pptx/docx/xlsx/pdf/csv/…).
    if (classifyEditedFile(path).category !== 'entity') continue;
    ops.push({
      kind: 'modified',
      linesAdded: 0,
      linesDeleted: 0,
      path,
      toolCallId: record.toolCallId,
      type: 'change',
    });
  }
  return ops;
};

const extractRecordOps = (record: FileEditToolCallRecord): EditOp[] => {
  // A plugin-level error means the edit never landed (server:
  // `message_plugins.error`; client: `tool.result?.error`) — skip the record
  // wholesale, same as an explicit `state` failure below.
  if (record.error != null && record.error !== '') return [];
  if (isFailedState(record.state)) return [];
  // A shell tool that exited non-zero produced no output file — skip it.
  if (hasNonZeroExitCode(record.state)) return [];

  // Gate each source on its identifier (all persisted to
  // `message_plugins.identifier`), not apiName alone: an unrelated third-party
  // plugin naming a tool `file_change` / `Edit` / `Write` must never be treated
  // as an editing tool.
  const structuredApiKind =
    record.identifier === CloudSandboxIdentifier
      ? CLOUD_SANDBOX_FILE_APIS.get(record.apiName)
      : record.identifier === LocalSystemIdentifier
        ? LOCAL_SYSTEM_FILE_APIS.get(record.apiName)
        : undefined;
  if (structuredApiKind) {
    return extractStructuredFileOps(record, structuredApiKind);
  }
  if (record.identifier === CODEX_IDENTIFIER && record.apiName === CODEX_FILE_CHANGE_API) {
    return extractCodexOps(record);
  }
  if (record.identifier === CLAUDE_CODE_IDENTIFIER && CLAUDE_CODE_EDIT_APIS.has(record.apiName)) {
    return extractClaudeCodeOps(record);
  }

  // Hetero-shell: lobe-local-system runCommand / claude-code Bash / codex
  // command_execution / DEVICE-routed lobe-skills runCommand+execScript — scan
  // the raw command text for entity-document write markers. Gated on
  // identifier+apiName so lobe-cloud-sandbox runCommand (covered by exportFile
  // registration) stays out; skills rows additionally require
  // `state.executionEnv === 'device'` — sandbox skills output is delivered via
  // exportFile, and legacy rows without the field are ambiguous.
  if (
    (record.identifier === LocalSystemIdentifier &&
      record.apiName === LocalSystemApiName.runCommand) ||
    (record.identifier === CLAUDE_CODE_IDENTIFIER && record.apiName === CLAUDE_CODE_BASH_API) ||
    (record.identifier === CODEX_IDENTIFIER && record.apiName === CODEX_COMMAND_API) ||
    (record.identifier === SkillsIdentifier &&
      SKILLS_SHELL_APIS.has(record.apiName) &&
      isRecord(record.state) &&
      record.state.executionEnv === 'device')
  ) {
    return extractShellCommandOps(record);
  }

  // Any other apiName — still a blind spot. Shell edits are now PARTIALLY
  // tracked (entity-document write markers only, above); sed / generic non-entity
  // file writes remain untracked.
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
