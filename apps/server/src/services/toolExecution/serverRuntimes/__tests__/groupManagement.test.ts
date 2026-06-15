// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';
import { groupManagementRuntime } from '../groupManagement';

const run = vi.fn();

const makeCtx = (overrides?: Partial<ToolExecutionContext>): ToolExecutionContext =>
  ({
    agentMember: { run },
    toolManifestMap: {},
    userId: 'user-1',
    ...overrides,
  }) as ToolExecutionContext;

const runtime = () => groupManagementRuntime.factory(makeCtx()) as any;

describe('groupManagementRuntime', () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue({ started: true, startedCount: 1 });
  });

  describe('speak', () => {
    it('forks one in-group member and resumes the supervisor', async () => {
      const result = await runtime().speak({ agentId: 'agent-a', instruction: 'hi' }, makeCtx());

      expect(run).toHaveBeenCalledWith({
        members: [{ agentId: 'agent-a', instruction: 'hi' }],
        mode: 'in_group',
        onComplete: 'resume',
      });
      expect(result).toMatchObject({ deferred: true, success: true });
      expect(result.state).toMatchObject({ status: 'pending', type: 'speak' });
    });

    it('finishes the supervisor when skipCallSupervisor is set', async () => {
      await runtime().speak({ agentId: 'agent-a', skipCallSupervisor: true }, makeCtx());
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ onComplete: 'finish' }));
    });

    it('errors without agentId', async () => {
      const result = await runtime().speak({} as any, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
      expect(run).not.toHaveBeenCalled();
    });

    it('errors when the agentMember runner is unavailable', async () => {
      const result = await runtime().speak(
        { agentId: 'agent-a' },
        makeCtx({ agentMember: undefined }),
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AGENT_MEMBER_UNAVAILABLE');
    });

    it('surfaces an inline error when no member started', async () => {
      run.mockResolvedValue({ started: false, startedCount: 0 });
      const result = await runtime().speak({ agentId: 'agent-a' }, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AGENT_MEMBER_START_FAILED');
    });
  });

  describe('broadcast', () => {
    it('forks N in-group members with tools disabled', async () => {
      run.mockResolvedValue({ started: true, startedCount: 2 });
      const result = await runtime().broadcast(
        { agentIds: ['a', 'b'], instruction: 'go' },
        makeCtx(),
      );

      expect(run).toHaveBeenCalledWith({
        disableTools: true,
        members: [
          { agentId: 'a', instruction: 'go' },
          { agentId: 'b', instruction: 'go' },
        ],
        mode: 'in_group',
        onComplete: 'resume',
      });
      expect(result).toMatchObject({ deferred: true, success: true });
    });

    it('errors without agentIds', async () => {
      const result = await runtime().broadcast({ agentIds: [] } as any, makeCtx());
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    });
  });

  describe('delegate', () => {
    it('hands off to a member and finishes (no resume)', async () => {
      await runtime().delegate({ agentId: 'agent-a', reason: 'you take it' }, makeCtx());
      expect(run).toHaveBeenCalledWith({
        members: [{ agentId: 'agent-a', instruction: 'you take it' }],
        mode: 'in_group',
        onComplete: 'finish',
      });
    });
  });

  describe('executeAgentTask', () => {
    it('runs an isolated-thread member and resumes', async () => {
      const result = await runtime().executeAgentTask(
        { agentId: 'agent-a', instruction: 'do work', timeout: 60_000, title: 'work' },
        makeCtx(),
      );
      expect(run).toHaveBeenCalledWith({
        members: [{ agentId: 'agent-a', instruction: 'do work' }],
        mode: 'isolated',
        onComplete: 'resume',
        timeout: 60_000,
      });
      expect(result).toMatchObject({ deferred: true, success: true });
    });

    it('errors without instruction', async () => {
      const result = await runtime().executeAgentTask({ agentId: 'agent-a' } as any, makeCtx());
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    });
  });

  describe('executeAgentTasks', () => {
    it('runs parallel isolated tasks and collapses timeout to the longest', async () => {
      run.mockResolvedValue({ started: true, startedCount: 2 });
      await runtime().executeAgentTasks(
        {
          tasks: [
            { agentId: 'a', instruction: 'ta', timeout: 1000, title: 'A' },
            { agentId: 'b', instruction: 'tb', timeout: 5000, title: 'B' },
          ],
        },
        makeCtx(),
      );
      expect(run).toHaveBeenCalledWith({
        members: [
          { agentId: 'a', instruction: 'ta' },
          { agentId: 'b', instruction: 'tb' },
        ],
        mode: 'isolated',
        onComplete: 'resume',
        timeout: 5000,
      });
    });

    it('errors without tasks', async () => {
      const result = await runtime().executeAgentTasks({ tasks: [] } as any, makeCtx());
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    });
  });
});
