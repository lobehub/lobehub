import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { HeteroSessionImportMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureClaudeCodeResumeTranscript,
  resolveClaudeCodeTranscriptPath,
} from './ensureResumeTranscript';

const SESSION_ID = '72f65fa9-0355-45d3-b903-8f41027ed5f2';

const messages: HeteroSessionImportMessage[] = [
  {
    clientId: 'u1',
    content: 'Remember the token MAGIC-4247.',
    createdAt: '2026-07-01T00:00:00.000Z',
    role: 'user',
  },
  { clientId: 'a1', content: 'stored', createdAt: '2026-07-01T00:00:01.000Z', role: 'assistant' },
];

let home: string;
let cwd: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'cc-home-'));
  cwd = await mkdtemp(path.join(tmpdir(), 'cc-cwd-'));
});

afterEach(async () => {
  await rm(home, { force: true, recursive: true });
  await rm(cwd, { force: true, recursive: true });
});

describe('resolveClaudeCodeTranscriptPath', () => {
  it('builds <home>/.claude/projects/<encoded-realpath-cwd>/<id>.jsonl', async () => {
    const p = await resolveClaudeCodeTranscriptPath({ cwd, home, sessionId: SESSION_ID });
    expect(p).not.toBeNull();
    // cwd is realpath-resolved (macOS tmp symlinks), so assert on the shape
    expect(p!.startsWith(path.join(home, '.claude', 'projects'))).toBe(true);
    expect(p!.endsWith(`${SESSION_ID}.jsonl`)).toBe(true);
    // the dir segment is a dash-slug with no slashes/dots
    const dir = path.basename(path.dirname(p!));
    expect(dir).toMatch(/^[\dA-Z-]+$/i);
  });
});

describe('ensureClaudeCodeResumeTranscript', () => {
  it('writes a rebuilt transcript when the file is missing', async () => {
    const res = await ensureClaudeCodeResumeTranscript({
      cwd,
      home,
      messages,
      sessionId: SESSION_ID,
    });
    expect(res.written).toBe(true);
    expect(res.reason).toBe('written');
    const content = await readFile(res.path!, 'utf8');
    expect(content).toContain('MAGIC-4247');
    expect(content).toContain(`"sessionId":"${SESSION_ID}"`);
    // at least one line the CLI's existence gate accepts
    expect(content).toMatch(/"type":"(user|assistant)"/);
  });

  it('never clobbers an existing (live) transcript', async () => {
    const p = (await resolveClaudeCodeTranscriptPath({ cwd, home, sessionId: SESSION_ID }))!;
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, '{"type":"user","original":true}\n', 'utf8');

    const res = await ensureClaudeCodeResumeTranscript({
      cwd,
      home,
      messages,
      sessionId: SESSION_ID,
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe('exists');
    expect(await readFile(p, 'utf8')).toContain('"original":true');
  });

  it('no-ops (does not write) when there are no messages', async () => {
    const res = await ensureClaudeCodeResumeTranscript({
      cwd,
      home,
      messages: [],
      sessionId: SESSION_ID,
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe('no-messages');
  });
});

describe('session-id validation (path traversal)', () => {
  // heteroSessionId is an unconstrained string on topic metadata, so on a shared
  // topic a collaborator controls it — and it lands in a filesystem path.
  const TRAVERSAL_IDS = [
    '../../../../../../tmp/pwned',
    '..',
    '../72f65fa9-0355-45d3-b903-8f41027ed5f2',
    'a/b',
    String.raw`..\..\windows`,
    '',
    'not-a-uuid',
    // a UUID with a traversal suffix must not slip through a loose match
    '72f65fa9-0355-45d3-b903-8f41027ed5f2/../../escape',
  ];

  it.each(TRAVERSAL_IDS)('rejects %j instead of resolving a path', async (sessionId) => {
    expect(await resolveClaudeCodeTranscriptPath({ cwd, home, sessionId })).toBeNull();
  });

  it('writes nothing to disk for a traversal id', async () => {
    const escapeTarget = path.join(tmpdir(), `cc-escape-${process.pid}`);
    await rm(escapeTarget, { force: true, recursive: true }).catch(() => {});

    const res = await ensureClaudeCodeResumeTranscript({
      cwd,
      home,
      messages,
      // path.join would collapse this to <tmpdir>/cc-escape-<pid>.jsonl
      sessionId: path.relative(path.join(home, '.claude', 'projects', 'x'), escapeTarget),
    });

    expect(res.written).toBe(false);
    expect(res.reason).toBe('invalid-session-id');
    expect(res.path).toBeNull();
    await expect(stat(`${escapeTarget}.jsonl`)).rejects.toThrow();
  });

  it('still accepts a well-formed uppercase-hex UUID', async () => {
    const p = await resolveClaudeCodeTranscriptPath({
      cwd,
      home,
      sessionId: SESSION_ID.toUpperCase(),
    });
    expect(p).not.toBeNull();
    const lower = await resolveClaudeCodeTranscriptPath({ cwd, home, sessionId: SESSION_ID });
    expect(path.dirname(p!)).toBe(path.dirname(lower!));
  });
});
