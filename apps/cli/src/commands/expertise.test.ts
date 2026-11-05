import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as format from '../utils/format';
import { confirm } from '../utils/format';
import { log } from '../utils/logger';
import { registerExpertiseCommand } from './expertise';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: { getBuiltinAgent: { query: vi.fn() } },
    expertise: {
      countHistory: { query: vi.fn() },
      createRule: { mutate: vi.fn() },
      getLesson: { query: vi.fn() },
      ingestHistory: { mutate: vi.fn() },
      listByAgent: { query: vi.fn() },
      listLessons: { query: vi.fn() },
      listRules: { query: vi.fn() },
      mergeRules: { mutate: vi.fn() },
      moveRule: { mutate: vi.fn() },
      reorderRule: { mutate: vi.fn() },
      restoreLesson: { mutate: vi.fn() },
      retireLesson: { mutate: vi.fn() },
      reviseLesson: { mutate: vi.fn() },
      teachLesson: { mutate: vi.fn() },
      updateRule: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof format>()),
  confirm: vi.fn(),
}));

const { expertise } = mockTrpcClient;

const domain = (id: string) => ({
  id,
  lastPracticedAt: null,
  lessons: [],
  runCount: 0,
  title: `Domain ${id}`,
});

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerExpertiseCommand(program);
  return program.parseAsync(['node', 'test', 'expertise', ...args]);
};

describe('expertise command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // `process.exit` must stop the action as it does in production.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit:${code}`);
    }) as any);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const output = () => consoleSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');

  describe('agent resolution', () => {
    it('requires an agent for domains', async () => {
      await expect(run('domains')).rejects.toThrow('exit:1');
      expect(log.error).toHaveBeenCalledWith('Either --agent or --slug is required.');
      expect(expertise.listByAgent.query).not.toHaveBeenCalled();
    });

    it('resolves --slug through the shared resolver', async () => {
      mockTrpcClient.agent.getBuiltinAgent.query.mockResolvedValue({ id: 'agt_inbox' });
      expertise.listByAgent.query.mockResolvedValue({ domains: [] });

      await run('domains', '--slug', 'inbox');

      expect(mockTrpcClient.agent.getBuiltinAgent.query).toHaveBeenCalledWith({ slug: 'inbox' });
      expect(expertise.listByAgent.query).toHaveBeenCalledWith({ agentId: 'agt_inbox' });
    });

    it('prints domains as JSON with the requested fields', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1')] });

      await run('domains', '--agent', 'a1', '--json', 'id');

      expect(JSON.parse(output())).toEqual([{ id: 'd1' }]);
    });
  });

  describe('lessons', () => {
    it('lists lessons across all domains of an agent', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1'), domain('d2')] });
      expertise.listLessons.query.mockImplementation(async ({ domainId }: any) => [
        { code: 'P-01', hitCount: 0, id: `l-${domainId}`, tier: 'unused', title: 'T' },
      ]);

      await run('lessons', 'list', '--agent', 'a1', '--search', 'x', '--json', 'id');

      expect(expertise.listLessons.query).toHaveBeenCalledWith({
        domainId: 'd1',
        layer: undefined,
        search: 'x',
      });
      expect(JSON.parse(output())).toEqual([{ id: 'l-d1' }, { id: 'l-d2' }]);
    });

    it('refuses a domain that is not bound to the given agent', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1')] });

      await expect(
        run('lessons', 'teach', 'hi', '--agent', 'a1', '--domain', 'd9'),
      ).rejects.toThrow('exit:1');

      expect(expertise.teachLesson.mutate).not.toHaveBeenCalled();
    });

    it('passes taught text through unchanged, without truncating or splitting', async () => {
      const text = `  ${'x'.repeat(3000)}\nsecond line  `;
      expertise.teachLesson.mutate.mockResolvedValue({ code: 'P-01', id: 'l1' });

      await run('lessons', 'teach', text, '--domain', 'd1');

      expect(expertise.teachLesson.mutate).toHaveBeenCalledTimes(1);
      expect(expertise.teachLesson.mutate).toHaveBeenCalledWith({ domainId: 'd1', text });
    });

    it('teaches through an agent with exactly one domain', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1')] });
      expertise.teachLesson.mutate.mockResolvedValue({ code: 'P-01', id: 'l1' });

      await run('lessons', 'teach', 'hi', '--agent', 'a1');

      expect(expertise.teachLesson.mutate).toHaveBeenCalledWith({ domainId: 'd1', text: 'hi' });
    });

    it('does not pick a domain when the agent has several', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1'), domain('d2')] });

      await expect(run('lessons', 'teach', 'hi', '--agent', 'a1')).rejects.toThrow('exit:1');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('d1, d2'));
      expect(expertise.teachLesson.mutate).not.toHaveBeenCalled();
    });

    it('fails when a revise finds no lesson', async () => {
      expertise.reviseLesson.mutate.mockResolvedValue(null);

      await expect(run('lessons', 'revise', 'l1', 'fix')).rejects.toThrow('exit:1');
    });

    it('does not retire without confirmation', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await run('lessons', 'retire', 'l1');

      expect(expertise.retireLesson.mutate).not.toHaveBeenCalled();
    });

    it('retires with --yes without prompting', async () => {
      expertise.retireLesson.mutate.mockResolvedValue({ id: 'l1' });

      await run('lessons', 'retire', 'l1', '--yes');

      expect(confirm).not.toHaveBeenCalled();
      expect(expertise.retireLesson.mutate).toHaveBeenCalledWith({ lessonId: 'l1' });
    });

    it('restores a retired lesson', async () => {
      expertise.restoreLesson.mutate.mockResolvedValue({ id: 'l1' });

      await run('lessons', 'restore', 'l1');

      expect(expertise.restoreLesson.mutate).toHaveBeenCalledWith({ lessonId: 'l1' });
    });

    it('fails when a lesson cannot be restored', async () => {
      expertise.restoreLesson.mutate.mockResolvedValue(null);

      await expect(run('lessons', 'restore', 'l1')).rejects.toThrow('exit:1');
    });

    it('fails when viewing a missing lesson', async () => {
      expertise.getLesson.query.mockResolvedValue(null);

      await expect(run('lessons', 'view', 'l1')).rejects.toThrow('exit:1');
    });
  });

  describe('rules', () => {
    const rule = (id: string, status: string) => ({
      code: 'P-01',
      enforcement: 'remind',
      hitCount: 0,
      id,
      status,
      title: id,
    });
    const group = (id: string) => ({
      domain: { id, title: id },
      rules: [rule(`${id}-active`, 'active'), rule(`${id}-retired`, 'retired')],
    });

    beforeEach(() => {
      expertise.listRules.query.mockResolvedValue({
        backlogRounds: 0,
        groups: [group('d1'), group('d2')],
      });
    });

    it('hides retired rules unless asked', async () => {
      await run('rules', 'list', '--domain', 'd1', '--json');
      expect(JSON.parse(output())[0].rules.map((r: any) => r.id)).toEqual(['d1-active']);

      consoleSpy.mockClear();
      await run('rules', 'list', '--domain', 'd1', '--include-retired', '--json');
      expect(JSON.parse(output())[0].rules.map((r: any) => r.id)).toEqual([
        'd1-active',
        'd1-retired',
      ]);
    });

    it('narrows to the domains of an agent', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d2')] });

      await run('rules', 'list', '--agent', 'a1', '--json');

      expect(JSON.parse(output()).map((g: any) => g.domain.id)).toEqual(['d2']);
    });

    it('lists every group without a target', async () => {
      await run('rules', 'list', '--json');

      expect(expertise.listByAgent.query).not.toHaveBeenCalled();
      expect(JSON.parse(output())).toHaveLength(2);
    });

    it('rejects an invalid enforcement before calling the server', async () => {
      await expect(
        run('rules', 'create', '--domain', 'd1', '--title', 'T', '--enforcement', 'nope'),
      ).rejects.toThrow('exit:1');

      expect(expertise.createRule.mutate).not.toHaveBeenCalled();
    });

    it('sends only the sections that were given, keeping an empty value to clear one', async () => {
      expertise.updateRule.mutate.mockResolvedValue({ id: 'l1' });

      await run('rules', 'update', 'l1', '--why', '', '--how', 'do it');

      expect(expertise.updateRule.mutate).toHaveBeenCalledWith({
        lessonId: 'l1',
        sections: { how: 'do it', why: '' },
      });
    });

    it('fails an update with no changes', async () => {
      await expect(run('rules', 'update', 'l1')).rejects.toThrow('exit:1');

      expect(expertise.updateRule.mutate).not.toHaveBeenCalled();
    });

    it('reorders to the end by default', async () => {
      expertise.reorderRule.mutate.mockResolvedValue({ domainId: 'd1', order: [] });

      await run('rules', 'reorder', 'l1', '--domain', 'd1');

      expect(expertise.reorderRule.mutate).toHaveBeenCalledWith({
        beforeId: null,
        domainId: 'd1',
        lessonId: 'l1',
      });
    });

    it('reorders before a rule of the same domain', async () => {
      expertise.getLesson.query.mockResolvedValue({
        lesson: { domainId: 'd1', status: 'active' },
      });
      expertise.reorderRule.mutate.mockResolvedValue({ domainId: 'd1', order: [] });

      await run('rules', 'reorder', 'l1', '--domain', 'd1', '--before', 'l2');

      expect(expertise.reorderRule.mutate).toHaveBeenCalledWith({
        beforeId: 'l2',
        domainId: 'd1',
        lessonId: 'l1',
      });
    });

    it.each([
      ['missing', null],
      ['in another domain', { lesson: { domainId: 'd2', status: 'active' } }],
      ['retired', { lesson: { domainId: 'd1', status: 'retired' } }],
    ])('does not reorder when --before is %s', async (_, target) => {
      expertise.getLesson.query.mockResolvedValue(target);

      await expect(
        run('rules', 'reorder', 'l1', '--domain', 'd1', '--before', 'l2'),
      ).rejects.toThrow('exit:1');

      expect(expertise.reorderRule.mutate).not.toHaveBeenCalled();
    });

    it('prints the live id after a move', async () => {
      expertise.moveRule.mutate.mockResolvedValue({ domainId: 'd2', id: 'l-copy' });

      await run('rules', 'move', 'l1', '--domain', 'd2');

      expect(output()).toContain('l-copy');
    });

    it('merges from the source into the target', async () => {
      expertise.mergeRules.mutate.mockResolvedValue({ fromId: 'l1', intoId: 'l2', revision: 2 });

      await run('rules', 'merge', 'l1', '--into', 'l2', '--yes');

      expect(expertise.mergeRules.mutate).toHaveBeenCalledWith({ fromId: 'l1', intoId: 'l2' });
    });

    it('fails when the server refuses a merge', async () => {
      expertise.mergeRules.mutate.mockResolvedValue(null);

      await expect(run('rules', 'merge', 'l1', '--into', 'l2', '--yes')).rejects.toThrow('exit:1');
    });

    it('does not merge without confirmation', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await run('rules', 'merge', 'l1', '--into', 'l2');

      expect(expertise.mergeRules.mutate).not.toHaveBeenCalled();
    });
  });

  describe('ingest-history', () => {
    beforeEach(() => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [domain('d1')] });
    });

    it('refuses an agent with no domains', async () => {
      expertise.listByAgent.query.mockResolvedValue({ domains: [] });

      await expect(run('ingest-history', '--agent', 'a1', '--yes')).rejects.toThrow('exit:1');

      expect(expertise.ingestHistory.mutate).not.toHaveBeenCalled();
    });

    it('starts nothing when there is no history', async () => {
      expertise.countHistory.query.mockResolvedValue({ candidateCount: 0 });

      await run('ingest-history', '--agent', 'a1', '--yes');

      expect(expertise.ingestHistory.mutate).not.toHaveBeenCalled();
    });

    it('states the count in the prompt and respects a refusal', async () => {
      expertise.countHistory.query.mockResolvedValue({ candidateCount: 7 });
      vi.mocked(confirm).mockResolvedValue(false);

      await run('ingest-history', '--agent', 'a1');

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('7'));
      expect(expertise.ingestHistory.mutate).not.toHaveBeenCalled();
    });

    it('starts the workflow with --yes', async () => {
      expertise.countHistory.query.mockResolvedValue({ candidateCount: 7 });
      expertise.ingestHistory.mutate.mockResolvedValue({ candidateCount: 7, workflowRunId: 'w1' });

      await run('ingest-history', '--agent', 'a1', '--yes');

      expect(expertise.ingestHistory.mutate).toHaveBeenCalledWith({ agentId: 'a1' });
      expect(output()).toContain('w1');
    });
  });
});
