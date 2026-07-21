import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeteroSessionCtr, { isUnderRoot } from '../HeteroSessionCtr';

const { ipcMainHandleMock, homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, homedir: homedirMock };
});

// ---------- fixtures ----------

const fakeHome = mkdtempSync(path.join(tmpdir(), 'hetero-session-ctr-'));
homedirMock.mockReturnValue(fakeHome);

const ccLine = (record: Record<string, any>) => JSON.stringify(record);

const writeCcSession = (folder: string, sessionId: string, cwd: string) => {
  const dir = path.join(fakeHome, '.claude', 'projects', folder);
  mkdirSync(dir, { recursive: true });
  const lines = [
    ccLine({
      cwd,
      gitBranch: 'main',
      isSidechain: false,
      message: { content: [{ text: `question of ${sessionId}`, type: 'text' }], role: 'user' },
      parentUuid: null,
      sessionId,
      timestamp: '2026-07-01T00:00:00.000Z',
      type: 'user',
      uuid: `${sessionId}-u1`,
    }),
    ccLine({
      isSidechain: false,
      message: {
        content: [{ text: 'answer', type: 'text' }],
        id: `${sessionId}-msg1`,
        model: 'claude-opus-4-8',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      parentUuid: `${sessionId}-u1`,
      sessionId,
      timestamp: '2026-07-01T00:00:01.000Z',
      type: 'assistant',
      uuid: `${sessionId}-a1`,
    }),
    ccLine({ leafUuid: `${sessionId}-a1`, sessionId, type: 'last-prompt' }),
  ];
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
};

const writeCcSubagent = (sessionFilePath: string, sessionId: string) => {
  const subDir = path.join(sessionFilePath.replace(/\.jsonl$/, ''), 'subagents');
  mkdirSync(subDir, { recursive: true });
  const lines = [
    ccLine({
      agentId: 'sub1',
      isSidechain: true,
      message: { content: [{ text: 'subagent prompt', type: 'text' }], role: 'user' },
      parentUuid: null,
      sessionId,
      timestamp: '2026-07-01T00:00:02.000Z',
      type: 'user',
      uuid: `${sessionId}-s1`,
    }),
    ccLine({
      agentId: 'sub1',
      isSidechain: true,
      message: { content: [{ text: 'subagent answer', type: 'text' }], id: `${sessionId}-smsg` },
      parentUuid: `${sessionId}-s1`,
      sessionId,
      timestamp: '2026-07-01T00:00:03.000Z',
      type: 'assistant',
      uuid: `${sessionId}-s2`,
    }),
  ];
  writeFileSync(path.join(subDir, 'agent-abc.jsonl'), lines.join('\n'));
};

const writeCodexSession = (sessionId: string, cwd: string) => {
  const dir = path.join(fakeHome, '.codex', 'sessions', '2026', '07', '01');
  mkdirSync(dir, { recursive: true });
  const lines = [
    ccLine({
      payload: { cwd, git: { branch: 'main' }, id: sessionId },
      timestamp: '2026-07-01T00:00:00.000Z',
      type: 'session_meta',
    }),
    ccLine({
      payload: {
        content: [{ text: 'codex question', type: 'input_text' }],
        role: 'user',
        type: 'message',
      },
      timestamp: '2026-07-01T00:00:01.000Z',
      type: 'response_item',
    }),
    ccLine({
      payload: {
        content: [{ text: 'codex answer', type: 'output_text' }],
        role: 'assistant',
        type: 'message',
      },
      timestamp: '2026-07-01T00:00:02.000Z',
      type: 'response_item',
    }),
  ];
  const filePath = path.join(dir, `rollout-${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
};

// two CC storage folders resolving to the SAME cwd (EnterWorktree case) + one other cwd
const ccFileA = writeCcSession('-repo-main', 'sess-a', '/repo/main');
writeCcSession('-repo-main--claude-worktrees-x', 'sess-b', '/repo/main');
writeCcSession('-repo-other', 'sess-c', '/repo/other');
writeCcSubagent(ccFileA, 'sess-a');
writeCcSession('-tmp-probe', 'sess-tmp', '/tmp/probe');
const codexFile = writeCodexSession('cdx-1', '/repo/main');
// corrupt file must not fail the scan
writeFileSync(
  path.join(fakeHome, '.claude', 'projects', '-repo-main', 'broken.jsonl'),
  '{not json',
);

afterAll(() => {
  rmSync(fakeHome, { force: true, recursive: true });
});

// ---------- app mock ----------

const storeData: Record<string, any> = { heteroSessionDirPrefs: {} };
const mockApp = {
  storeManager: {
    get: vi.fn((key: string, fallback?: any) => storeData[key] ?? fallback),
    set: vi.fn((key: string, value: any) => {
      storeData[key] = value;
    }),
  },
} as unknown as App;

describe('HeteroSessionCtr', () => {
  let controller: HeteroSessionCtr;

  beforeEach(() => {
    storeData.heteroSessionDirPrefs = {};
    controller = new HeteroSessionCtr(mockApp);
  });

  describe('listLocalSessions', () => {
    it('aggregates by resolved workingDirectory across storage folders', async () => {
      const { errors, groups } = await controller.listLocalSessions();

      const ccMain = groups.find(
        (g) => g.source === 'claude-code' && g.workingDirectory === '/repo/main',
      )!;
      // sess-a and sess-b live in different storage folders but share the cwd
      expect(ccMain.sessionCount).toBe(2);
      expect(ccMain.isGit).toBe(true);
      expect(ccMain.totalTokens).toBe(300); // 2 × (100 + 50)

      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/other')
          ?.sessionCount,
      ).toBe(1);
      expect(
        groups.find((g) => g.source === 'codex' && g.workingDirectory === '/repo/main')
          ?.sessionCount,
      ).toBe(1);
      // the corrupt file is skipped silently (unparsable lines ≠ scan error)
      expect(errors).toEqual([]);
    });

    it('attaches persisted dir prefs to their groups', async () => {
      storeData.heteroSessionDirPrefs = { 'claude-code::/repo/other': 'ignored' };
      const { groups } = await controller.listLocalSessions();

      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/other')
          ?.dirPref,
      ).toBe('ignored');
      expect(
        groups.find((g) => g.source === 'claude-code' && g.workingDirectory === '/repo/main')
          ?.dirPref,
      ).toBeUndefined();
    });
  });

  describe('temp directory defaults', () => {
    it('default-ignores temp working directories', async () => {
      const { groups } = await controller.listLocalSessions();
      expect(groups.find((g) => g.workingDirectory === '/tmp/probe')?.dirPref).toBe('ignored');
    });

    it('restoring a temp dir stores `none` so the default does not re-apply', async () => {
      await controller.setDirPref({ key: 'claude-code::/tmp/probe', pref: null });
      expect(storeData.heteroSessionDirPrefs).toEqual({ 'claude-code::/tmp/probe': 'none' });

      const { groups } = await controller.listLocalSessions();
      expect(groups.find((g) => g.workingDirectory === '/tmp/probe')?.dirPref).toBeUndefined();
    });
  });

  describe('readLocalSession', () => {
    it('builds a Claude Code payload with subagent threads', async () => {
      const payload = await controller.readLocalSession({
        filePath: ccFileA,
        source: 'claude-code',
      });

      expect(payload?.topicClientId).toBe('claude-code-session-sess-a');
      expect(payload?.messages).toHaveLength(2);
      expect(payload?.threads).toHaveLength(1);
      expect(payload?.threads?.[0]).toMatchObject({
        clientId: 'claude-code-thread-agent-abc',
        type: 'standalone',
      });
      expect(payload?.threads?.[0].messages).toHaveLength(2);
    });

    it('builds a Codex payload', async () => {
      const payload = await controller.readLocalSession({
        filePath: codexFile,
        source: 'codex',
      });

      expect(payload?.topicClientId).toBe('codex-session-cdx-1');
      expect(payload?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('refuses to read files outside the CLI transcript roots', async () => {
      await expect(
        controller.readLocalSession({ filePath: '/etc/passwd', source: 'claude-code' }),
      ).rejects.toThrow('outside');
    });
  });

  describe('isUnderRoot boundary', () => {
    // regression: the boundary used a literal "/", so on Windows — where the
    // resolved path is separated by "\" — every real transcript was rejected
    // as "outside" and no session could be imported.
    it('accepts a transcript under the root on Windows separators', () => {
      const root = 'C:\\Users\\me\\.claude\\projects';
      const file = 'C:\\Users\\me\\.claude\\projects\\proj\\a.jsonl';

      expect(isUnderRoot(file, root, path.win32)).toBe(true);
    });

    it('accepts a transcript under the root on POSIX separators', () => {
      expect(
        isUnderRoot(
          '/home/me/.claude/projects/proj/a.jsonl',
          '/home/me/.claude/projects',
          path.posix,
        ),
      ).toBe(true);
    });

    it('rejects paths outside the root, including sibling prefixes', () => {
      expect(isUnderRoot('/etc/passwd', '/home/me/.claude/projects', path.posix)).toBe(false);
      // a sibling dir that merely shares the root as a string prefix
      expect(
        isUnderRoot(
          '/home/me/.claude/projects-evil/a.jsonl',
          '/home/me/.claude/projects',
          path.posix,
        ),
      ).toBe(false);
      expect(
        isUnderRoot('C:\\Users\\me\\.ssh\\id_rsa', 'C:\\Users\\me\\.claude\\projects', path.win32),
      ).toBe(false);
    });
  });

  describe('dir prefs', () => {
    it('sets, persists and clears preferences', async () => {
      await controller.setDirPref({ key: 'codex::/repo/main', pref: 'watched' });
      expect(await controller.getDirPrefs()).toEqual({ 'codex::/repo/main': 'watched' });

      await controller.setDirPref({ key: 'codex::/repo/main', pref: null });
      expect(await controller.getDirPrefs()).toEqual({});
    });
  });
});
