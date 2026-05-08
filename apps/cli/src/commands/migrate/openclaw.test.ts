import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: {
      createAgent: { mutate: vi.fn() },
      getBuiltinAgent: { query: vi.fn() },
    },
    agentDocument: {
      upsertDocument: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockConfirm } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  getTrpcClient: mockGetTrpcClient,
}));

vi.mock('../../settings', () => ({
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

vi.mock('../../utils/format', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, confirm: mockConfirm };
});

vi.mock('../../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

// eslint-disable-next-line import-x/first
import { log } from '../../utils/logger';
// eslint-disable-next-line import-x/first
import { registerOpenClawMigration } from './openclaw';

// ── Helpers ────────────────────────────────────────────

let tmpDir: string;

function createProgram() {
  const program = new Command();
  program.exitOverride();
  const migrate = program.command('migrate');
  registerOpenClawMigration(migrate);
  return program;
}

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ── Setup / teardown ───────────────────────────────────

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit');
  }) as any);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
  mockConfirm.mockResolvedValue(true);
});

afterEach(() => {
  exitSpy.mockRestore();
  consoleSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────

describe('migrate openclaw', () => {
  // ── Profile parsing ────────────────────────────────

  describe('agent profile from workspace', () => {
    it('should read name, description, and emoji from IDENTITY.md', async () => {
      writeFile(
        'IDENTITY.md',
        ['# IDENTITY.md', '- **Name:** 龙虾', '- **Creature:** AI 助手', '- **Emoji:** 🦞'].join(
          '\n',
        ),
      );
      writeFile('hello.md', 'hello');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith({
        config: {
          avatar: '🦞',
          description: 'AI 助手',
          title: '龙虾',
        },
      });
    });

    it('should filter out placeholder emoji like （待定）', async () => {
      writeFile(
        'IDENTITY.md',
        ['# IDENTITY.md', '- **Name:** TestBot', '- **Emoji:**', '  _(待定)_'].join('\n'),
      );
      writeFile('hello.md', 'hello');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith({
        config: {
          avatar: undefined,
          description: undefined,
          title: 'TestBot',
        },
      });
    });

    it('should fall back to "OpenClaw" when no identity files exist', async () => {
      writeFile('doc.md', 'content');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith({
        config: {
          avatar: undefined,
          description: undefined,
          title: 'OpenClaw',
        },
      });
    });
  });

  // ── File filtering ─────────────────────────────────

  describe('file collection and filtering', () => {
    it('should exclude common directories like node_modules and .git', async () => {
      writeFile('README.md', 'readme');
      writeFile('node_modules/pkg/index.js', 'module');
      writeFile('.git/config', 'git');
      writeFile('.idea/workspace.xml', 'ide');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'README.md' }),
      );
    });

    it('should exclude files matching glob patterns like *.pyc and *.log', async () => {
      writeFile('main.py', 'print("hi")');
      writeFile('main.pyc', 'bytecode');
      writeFile('app.log', 'log data');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'main.py' }),
      );
    });

    it('should respect workspace .gitignore', async () => {
      writeFile('.gitignore', 'secret.txt\ndata/\n');
      writeFile('README.md', 'readme');
      writeFile('secret.txt', 'password');
      writeFile('data/dump.sql', 'sql');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      const filenames = mockTrpcClient.agentDocument.upsertDocument.mutate.mock.calls.map(
        (c: any[]) => c[0].filename,
      );
      expect(filenames).toContain('README.md');
      expect(filenames).not.toContain('secret.txt');
      expect(filenames).not.toContain('data/dump.sql');
    });

    it('should skip binary files during import', async () => {
      writeFile('readme.md', 'text content');
      // Write a file with null bytes (binary)
      const binPath = path.join(tmpDir, 'image.dat');
      fs.writeFileSync(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]));

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      // Only the text file should be upserted
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'readme.md' }),
      );
      // Binary file should show as skipped in output
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(allOutput).toContain('skipped');
    });

    it('should exclude database files by extension', async () => {
      writeFile('data.md', 'notes');
      writeFile('local.sqlite', 'fake-sqlite');
      writeFile('app.db', 'fake-db');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'data.md' }),
      );
    });

    it('should collect files in subdirectories', async () => {
      writeFile('docs/guide.md', 'guide');
      writeFile('docs/api.md', 'api');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      const filenames = mockTrpcClient.agentDocument.upsertDocument.mutate.mock.calls
        .map((c: any[]) => c[0].filename)
        .sort();
      expect(filenames).toEqual(['docs/api.md', 'docs/guide.md']);
    });
  });

  // ── Dry run ────────────────────────────────────────

  describe('--dry-run', () => {
    it('should list files without calling API', async () => {
      writeFile('file.md', 'content');

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--dry-run',
      ]);

      expect(mockGetTrpcClient).not.toHaveBeenCalled();
      expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });
  });

  // ── Agent resolution ───────────────────────────────

  describe('agent resolution', () => {
    it('should use --agent-id directly when provided', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--agent-id',
        'agt_existing',
        '--yes',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt_existing' }),
      );
    });

    it('should resolve agent by --slug', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agent.getBuiltinAgent.query.mockResolvedValue({ id: 'agt_inbox' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--slug',
        'inbox',
        '--yes',
      ]);

      expect(mockTrpcClient.agent.getBuiltinAgent.query).toHaveBeenCalledWith({ slug: 'inbox' });
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt_inbox' }),
      );
    });

    it('should create a new agent by default', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_new' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt_new' }),
      );
    });
  });

  // ── Confirmation ───────────────────────────────────

  describe('confirmation', () => {
    it('should cancel when user declines', async () => {
      writeFile('file.md', 'content');
      mockConfirm.mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'migrate', 'openclaw', '--source', tmpDir]);

      expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('should skip confirmation with --yes', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });

  // ── Error handling ─────────────────────────────────

  describe('error handling', () => {
    it('should exit when source path does not exist', async () => {
      const program = createProgram();
      await program
        .parseAsync(['node', 'test', 'migrate', 'openclaw', '--source', '/nonexistent/path'])
        .catch(() => {}); // process.exit throws

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should report failed files without aborting', async () => {
      writeFile('a.md', 'ok');
      writeFile('b.md', 'fail');

      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      // Files are iterated in readdir order; mock first success then failure
      mockTrpcClient.agentDocument.upsertDocument.mutate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('upload error'));

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      expect(mockTrpcClient.agentDocument.upsertDocument.mutate).toHaveBeenCalledTimes(2);
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(allOutput).toContain('1 imported');
      expect(allOutput).toContain('1 failed');
    });

    it('should show no files message for empty workspace', async () => {
      // Only excluded items
      writeFile('.git/config', 'git');

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--dry-run',
      ]);

      expect(log.info).toHaveBeenCalledWith('No files found in workspace.');
    });
  });

  // ── Output ─────────────────────────────────────────

  describe('output', () => {
    it('should print agent URL on completion', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_abc123' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(allOutput).toContain('https://app.lobehub.com/agent/agt_abc123');
    });

    it('should show friendly completion message on success', async () => {
      writeFile('file.md', 'content');
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({ agentId: 'agt_test' });
      mockTrpcClient.agentDocument.upsertDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'migrate',
        'openclaw',
        '--source',
        tmpDir,
        '--yes',
      ]);

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(allOutput).toContain('Migration complete');
    });
  });
});
