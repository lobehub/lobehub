import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { VerifyTerminalArtifact, VerifyTerminalEvidenceMetadata } from '@lobechat/types';
import {
  formatTerminalTranscript,
  parseTerminalEvidenceMetadata,
  TERMINAL_ARTIFACT_KEYS,
  type TerminalArtifactKey,
} from '@lobechat/utils/verify/terminalEvidence';

/**
 * The local terminal evidence bundle — what `capture` / `import` write and
 * `upload` / `submit` / `ingest` publish. A plain directory, so the author can
 * read exactly what will be uploaded before anything leaves the machine:
 *
 *   terminal.json   the execution record (artifacts named by relative path)
 *   transcript.txt  the readable text fallback; the evidence payload
 *   stdout.txt / stderr.txt   pipe mode, one file per non-empty stream
 *   output.txt      pty / merged imports: the stream as plain text
 *   session.cast    asciicast v3, only when real timing was recorded
 *
 * Everything in it is already redacted; the raw output is never written.
 */

export const TERMINAL_RECORD_FILE = 'terminal.json';
export const TERMINAL_TRANSCRIPT_FILE = 'transcript.txt';

const ARTIFACT_FILES: Record<TerminalArtifactKey, string> = {
  cast: 'session.cast',
  output: 'output.txt',
  stderr: 'stderr.txt',
  stdout: 'stdout.txt',
};

const BUNDLE_FILES = new Set([
  TERMINAL_RECORD_FILE,
  TERMINAL_TRANSCRIPT_FILE,
  ...Object.values(ARTIFACT_FILES),
]);

export type TerminalRecordDraft = Omit<VerifyTerminalEvidenceMetadata, 'artifacts'>;

export interface TerminalBundleContent {
  cast?: string | null;
  output?: string | null;
  stderr?: string | null;
  stdout?: string | null;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/**
 * Prepare `dir` for a new bundle. An existing bundle is replaced only with
 * `force`, and only its own files are removed — a directory holding anything
 * else is refused, so a mistyped `--out` cannot wipe unrelated work.
 */
export const prepareBundleDir = (dir: string, force: boolean) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} exists and is not a directory`);
  const entries = readdirSync(dir);
  if (entries.length === 0) return;
  const foreign = entries.filter((name) => !BUNDLE_FILES.has(name));
  if (foreign.length > 0)
    throw new Error(
      `${dir} already contains other files (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ', …' : ''}); choose an empty or new --out directory`,
    );
  if (!force)
    throw new Error(`${dir} already holds a terminal evidence bundle; pass --force to replace it`);
  for (const name of entries) rmSync(path.join(dir, name), { force: true });
};

export interface WrittenBundle {
  dir: string;
  metadata: VerifyTerminalEvidenceMetadata;
  transcript: string;
}

/** Write a bundle and return its record. The record is validated before anything lands. */
export const writeTerminalBundle = (
  dir: string,
  draft: TerminalRecordDraft,
  content: TerminalBundleContent,
): WrittenBundle => {
  const artifacts: VerifyTerminalEvidenceMetadata['artifacts'] = {};
  const files: [string, string][] = [];
  for (const key of TERMINAL_ARTIFACT_KEYS) {
    const body = content[key];
    // An empty stream is a fact the record states (the transcript prints the
    // section as empty); it needs no file of its own.
    if (body === undefined || body === null || body.length === 0) continue;
    const name = ARTIFACT_FILES[key];
    const artifact: VerifyTerminalArtifact = {
      path: name,
      sha256: sha256(body),
      size: Buffer.byteLength(body),
    };
    artifacts[key] = artifact;
    files.push([name, body]);
  }

  const metadata: VerifyTerminalEvidenceMetadata = { ...draft, artifacts };
  const parsed = parseTerminalEvidenceMetadata(metadata);
  if (!parsed.ok) throw new Error(`Refusing to write an invalid terminal record: ${parsed.error}`);

  const transcript = formatTerminalTranscript(parsed.metadata, content);
  for (const [name, body] of files) writeFileSync(path.join(dir, name), body);
  writeFileSync(path.join(dir, TERMINAL_TRANSCRIPT_FILE), transcript);
  writeFileSync(
    path.join(dir, TERMINAL_RECORD_FILE),
    `${JSON.stringify(parsed.metadata, null, 2)}\n`,
  );
  return { dir, metadata: parsed.metadata, transcript };
};

/** `dir/` or `dir/terminal.json` → the bundle directory, or undefined when it is not one. */
export const terminalBundleDir = (target: string): string | undefined => {
  try {
    const stat = statSync(target);
    if (stat.isDirectory())
      return existsSync(path.join(target, TERMINAL_RECORD_FILE)) ? target : undefined;
    return path.basename(target) === TERMINAL_RECORD_FILE ? path.dirname(target) : undefined;
  } catch {
    return undefined;
  }
};

export interface LoadedBundle {
  /** Absolute path of each artifact file, keyed by artifact. */
  artifactFiles: Partial<Record<TerminalArtifactKey, string>>;
  dir: string;
  metadata: VerifyTerminalEvidenceMetadata;
  transcript: string;
  transcriptFile: string;
}

/**
 * Read a bundle back for publishing, refusing one whose files no longer match
 * the hashes recorded when it was written: the upload must be the bundle the
 * capture produced, not a copy edited afterwards.
 */
export const loadTerminalBundle = (target: string): LoadedBundle => {
  const dir = terminalBundleDir(target);
  if (!dir)
    throw new Error(`${target} is not a terminal evidence bundle (no ${TERMINAL_RECORD_FILE})`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dir, TERMINAL_RECORD_FILE), 'utf8'));
  } catch (error) {
    throw new Error(
      `${path.join(dir, TERMINAL_RECORD_FILE)} is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const parsed = parseTerminalEvidenceMetadata(raw);
  if (!parsed.ok) throw new Error(`${path.join(dir, TERMINAL_RECORD_FILE)}: ${parsed.error}`);

  const artifactFiles: LoadedBundle['artifactFiles'] = {};
  const streams: TerminalBundleContent = {};
  for (const key of TERMINAL_ARTIFACT_KEYS) {
    const artifact = parsed.metadata.artifacts[key];
    if (!artifact) continue;
    if (!artifact.path) throw new Error(`terminal.json: artifacts.${key} has no path`);
    const file = path.join(dir, artifact.path);
    if (!existsSync(file))
      throw new Error(`terminal.json: artifacts.${key} file ${artifact.path} is missing`);
    const data = readFileSync(file);
    if (data.length !== artifact.size || sha256(data) !== artifact.sha256)
      throw new Error(
        `${artifact.path} changed after the bundle was written (size or SHA-256 differs). Capture or import again instead of editing the bundle.`,
      );
    artifactFiles[key] = file;
    streams[key] = data.toString('utf8');
  }

  const transcriptFile = path.join(dir, TERMINAL_TRANSCRIPT_FILE);
  if (!existsSync(transcriptFile)) throw new Error(`${transcriptFile} is missing`);
  // The transcript is the published payload, so it must say exactly what the
  // verified streams and the record say: it was generated from them, and is
  // regenerated here. A mismatch means either was edited after the write.
  const transcript = readFileSync(transcriptFile, 'utf8');
  if (transcript !== formatTerminalTranscript(parsed.metadata, streams))
    throw new Error(
      `${TERMINAL_TRANSCRIPT_FILE} does not match the bundle's record and output (it or ${TERMINAL_RECORD_FILE} changed after the bundle was written). Capture or import again instead of editing the bundle.`,
    );
  return { artifactFiles, dir, metadata: parsed.metadata, transcript, transcriptFile };
};

/** The evidence caption when the author gave none: the command itself. */
export const terminalEvidenceDescription = (metadata: VerifyTerminalEvidenceMetadata) => {
  const command = metadata.execution.command ?? 'terminal output';
  const label = metadata.source.kind === 'authored' ? `Example: ${command}` : `$ ${command}`;
  return label.length > 160 ? `${label.slice(0, 159)}…` : label;
};
