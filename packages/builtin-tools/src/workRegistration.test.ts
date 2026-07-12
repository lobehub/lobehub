import type { LobeBuiltinTool, WorkRegistrationIntent } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  dispatchWorkRegistrationIntent,
  extractTaskWorkTargets,
  getApiWorkConfig,
  resolveWorkRegistration,
  workChangeTypeFromAction,
  type WorkRegistrationPorts,
  type WorkRegistrationProvenance,
} from './workRegistration';

const registry = [
  {
    identifier: 'lobe-task',
    manifest: {
      api: [
        { name: 'createTask', work: { action: 'create', resourceType: 'task' } },
        { name: 'createTasks', work: { action: 'create', resourceType: 'task' } },
        { name: 'editTask', work: { action: 'update', resourceType: 'task' } },
        { name: 'deleteTask', work: { action: 'delete', resourceType: 'task' } },
        { name: 'listTasks' },
      ],
    },
  },
] as unknown as LobeBuiltinTool[];

describe('getApiWorkConfig', () => {
  it('returns the work config for an API that declares one', () => {
    expect(getApiWorkConfig(registry, 'lobe-task', 'createTask')).toEqual({
      action: 'create',
      resourceType: 'task',
    });
  });

  it('returns undefined for an API without a work config', () => {
    expect(getApiWorkConfig(registry, 'lobe-task', 'listTasks')).toBeUndefined();
  });

  it('returns undefined for an unknown tool or API', () => {
    expect(getApiWorkConfig(registry, 'lobe-unknown', 'createTask')).toBeUndefined();
    expect(getApiWorkConfig(registry, 'lobe-task', 'unknownApi')).toBeUndefined();
  });
});

describe('workChangeTypeFromAction', () => {
  it('maps create → created and update → updated', () => {
    expect(workChangeTypeFromAction('create')).toBe('created');
    expect(workChangeTypeFromAction('update')).toBe('updated');
    // `delete` is excluded from the input type — it writes no version changeType and
    // must never be silently mapped to 'updated' (see resolveWorkRegistration).
  });
});

describe('extractTaskWorkTargets', () => {
  it('extracts a single created task from state (taskId + identifier)', () => {
    expect(
      extractTaskWorkTargets({
        args: { name: 'A', instruction: 'do' },
        result: { state: { identifier: 'T-1', taskId: 'task_1', success: true }, success: true },
      }),
    ).toEqual([{ taskId: 'task_1', taskIdentifier: 'T-1' }]);
  });

  it('falls back to args.identifier for updates that return no state (server runtime)', () => {
    expect(
      extractTaskWorkTargets({
        args: { identifier: 'T-9' },
        result: { success: true },
      }),
    ).toEqual([{ taskId: undefined, taskIdentifier: 'T-9' }]);
  });

  it('prefers state.identifier over args.identifier for updates', () => {
    expect(
      extractTaskWorkTargets({
        args: { identifier: 'T-args' },
        result: { state: { identifier: 'T-state', success: true }, success: true },
      }),
    ).toEqual([{ taskId: undefined, taskIdentifier: 'T-state' }]);
  });

  it('returns no targets when a single call failed', () => {
    expect(
      extractTaskWorkTargets({
        args: { identifier: 'T-1' },
        result: { success: false },
      }),
    ).toEqual([]);
  });

  it('extracts only the succeeded items from a batch, ignoring top-level success', () => {
    expect(
      extractTaskWorkTargets({
        args: { tasks: [] },
        result: {
          state: {
            failed: 1,
            results: [
              { identifier: 'T-A', name: 'A', success: true },
              { error: 'boom', name: 'B', success: false },
              { identifier: 'T-C', name: 'C', success: true },
            ],
            succeeded: 2,
          },
          // partial-failure batch reports overall failure but still registers winners
          success: false,
        },
      }),
    ).toEqual([
      { taskId: undefined, taskIdentifier: 'T-A' },
      { taskId: undefined, taskIdentifier: 'T-C' },
    ]);
  });

  it('returns no targets for an empty batch', () => {
    expect(
      extractTaskWorkTargets({
        args: { tasks: [] },
        result: { state: { failed: 0, results: [], succeeded: 0 }, success: false },
      }),
    ).toEqual([]);
  });
});

describe('resolveWorkRegistration', () => {
  it('resolves create/update into a changeType-bearing plan', () => {
    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'createTask', {
        args: {},
        result: { state: { identifier: 'T-1', taskId: 'task_1', success: true }, success: true },
      }),
    ).toEqual({
      action: 'create',
      changeType: 'created',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
    });

    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'editTask', {
        args: { identifier: 'T-9' },
        result: { success: true },
      }),
    ).toEqual({
      action: 'update',
      changeType: 'updated',
      targets: [{ taskId: undefined, taskIdentifier: 'T-9' }],
    });
  });

  it('resolves delete into a changeType-less plan keyed off state.taskId', () => {
    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'deleteTask', {
        args: { identifier: 'T-1' },
        result: { state: { identifier: 'T-1', taskId: 'task_1', success: true }, success: true },
      }),
    ).toEqual({
      action: 'delete',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
    });
  });

  it('returns undefined when a delete call yields no extractable target', () => {
    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'deleteTask', {
        args: { identifier: 'T-1' },
        result: { success: false },
      }),
    ).toBeUndefined();
  });

  it('returns undefined for an API without a work config', () => {
    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'listTasks', {
        args: {},
        result: { success: true },
      }),
    ).toBeUndefined();
  });
});

describe('dispatchWorkRegistrationIntent', () => {
  const provenance: WorkRegistrationProvenance = {
    actorAgentId: 'agent-1',
    cumulativeCost: 0.011,
    cumulativeUsage: { capturedAt: '2026-06-30T08:00:00.000Z', cost: { total: 0.011 } },
    rootOperationId: 'op-root',
    sourceMessageId: 'msg-1',
    sourceToolCallId: 'tool-call-1',
    sourceToolName: 'createTask',
    threadId: 'thread-1',
    topicId: 'topic-1',
  };

  const buildPorts = (overrides?: Partial<WorkRegistrationPorts>): WorkRegistrationPorts => ({
    deleteDocumentWork: vi.fn().mockResolvedValue(undefined),
    deleteTaskWork: vi.fn().mockResolvedValue(undefined),
    handleSkillToolResult: vi.fn().mockResolvedValue(undefined),
    registerDocument: vi.fn().mockResolvedValue(undefined),
    registerTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  describe('task', () => {
    it('registers every target of a create intent with provenance + cumulative usage', async () => {
      const ports = buildPorts();
      const intent: WorkRegistrationIntent = {
        action: 'create',
        changeType: 'created',
        targets: [
          { taskId: 'task_1', taskIdentifier: 'T-1' },
          { taskId: 'task_2', taskIdentifier: 'T-2' },
        ],
        type: 'task',
      };

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.registerTask).toHaveBeenCalledTimes(2);
      expect(ports.registerTask).toHaveBeenNthCalledWith(1, {
        actorAgentId: 'agent-1',
        changeType: 'created',
        cumulativeCost: 0.011,
        cumulativeUsage: provenance.cumulativeUsage,
        rootOperationId: 'op-root',
        source: 'createTask',
        sourceMessageId: 'msg-1',
        sourceToolCallId: 'tool-call-1',
        taskId: 'task_1',
        taskIdentifier: 'T-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      });
      expect(ports.registerTask).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ taskId: 'task_2', taskIdentifier: 'T-2' }),
      );
    });

    it('deletes each target that has a taskId and skips targetless ids', async () => {
      const ports = buildPorts();
      const intent: WorkRegistrationIntent = {
        action: 'delete',
        targets: [{ taskId: 'task_1' }, { taskIdentifier: 'T-2' }, { taskId: 'task_3' }],
        type: 'task',
      };

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.deleteTaskWork).toHaveBeenCalledTimes(2);
      expect(ports.deleteTaskWork).toHaveBeenCalledWith({ taskId: 'task_1' });
      expect(ports.deleteTaskWork).toHaveBeenCalledWith({ taskId: 'task_3' });
      expect(ports.registerTask).not.toHaveBeenCalled();
    });

    it('is a no-op for a create/update intent missing its changeType', async () => {
      const ports = buildPorts();
      const intent = {
        action: 'create',
        targets: [{ taskId: 'task_1' }],
        type: 'task',
      } as unknown as WorkRegistrationIntent;

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.registerTask).not.toHaveBeenCalled();
      expect(ports.deleteTaskWork).not.toHaveBeenCalled();
    });

    it('keeps registering siblings when one target rejects (allSettled tolerance)', async () => {
      const registerTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('trpc died'))
        .mockResolvedValueOnce(undefined);
      const ports = buildPorts({ registerTask });
      const intent: WorkRegistrationIntent = {
        action: 'create',
        changeType: 'created',
        targets: [{ taskId: 'task_1' }, { taskId: 'task_2' }],
        type: 'task',
      };

      await expect(
        dispatchWorkRegistrationIntent(intent, ports, provenance),
      ).resolves.toBeUndefined();
      expect(registerTask).toHaveBeenCalledTimes(2);
    });
  });

  describe('document', () => {
    it('registers a document with provenance + cumulative usage', async () => {
      const ports = buildPorts();
      const intent: WorkRegistrationIntent = {
        action: 'register',
        document: {
          agentId: 'agent-1',
          changeType: 'created',
          documentId: 'doc_1',
          source: 'createDocument',
          url: 'https://example.com/doc_1',
        },
        type: 'document',
      };

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.registerDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAgentId: 'agent-1',
          changeType: 'created',
          cumulativeCost: 0.011,
          documentId: 'doc_1',
          rootOperationId: 'op-root',
          source: 'createDocument',
          sourceToolCallId: 'tool-call-1',
          url: 'https://example.com/doc_1',
        }),
      );
    });

    it('routes a document delete to the deleteDocumentWork port when present', async () => {
      const ports = buildPorts();
      const intent: WorkRegistrationIntent = {
        action: 'delete',
        document: { agentId: 'agent-1', documentId: 'doc_1' },
        type: 'document',
      };

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.deleteDocumentWork).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'doc_1',
      });
      expect(ports.registerDocument).not.toHaveBeenCalled();
    });

    it('is a no-op for a document delete when the port is absent (client)', async () => {
      const ports = buildPorts({ deleteDocumentWork: undefined });
      const intent: WorkRegistrationIntent = {
        action: 'delete',
        document: { documentId: 'doc_1' },
        type: 'document',
      };

      await expect(
        dispatchWorkRegistrationIntent(intent, ports, provenance),
      ).resolves.toBeUndefined();
      expect(ports.registerDocument).not.toHaveBeenCalled();
    });
  });

  describe('skill', () => {
    it('forwards the skill payload to handleSkillToolResult with cumulative usage', async () => {
      const ports = buildPorts();
      const intent: WorkRegistrationIntent = {
        args: { title: 'x' },
        data: { url: 'https://linear.app/x' },
        provider: 'linear',
        toolName: 'createIssue',
        type: 'skill',
      };

      await dispatchWorkRegistrationIntent(intent, ports, provenance);

      expect(ports.handleSkillToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAgentId: 'agent-1',
          args: { title: 'x' },
          cumulativeCost: 0.011,
          data: { url: 'https://linear.app/x' },
          provider: 'linear',
          rootOperationId: 'op-root',
          sourceToolCallId: 'tool-call-1',
          toolName: 'createIssue',
        }),
      );
    });
  });
});
