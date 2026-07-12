import type { LobeBuiltinTool } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  extractTaskWorkTargets,
  getApiWorkConfig,
  resolveWorkRegistration,
  workRoleFromAction,
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

describe('workRoleFromAction', () => {
  it('maps create → created and update → updated', () => {
    expect(workRoleFromAction('create')).toBe('created');
    expect(workRoleFromAction('update')).toBe('updated');
    // `delete` is excluded from the input type — it writes no version role and
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
  it('resolves create/update into a role-bearing plan', () => {
    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'createTask', {
        args: {},
        result: { state: { identifier: 'T-1', taskId: 'task_1', success: true }, success: true },
      }),
    ).toEqual({
      action: 'create',
      role: 'created',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
    });

    expect(
      resolveWorkRegistration(registry, 'lobe-task', 'editTask', {
        args: { identifier: 'T-9' },
        result: { success: true },
      }),
    ).toEqual({
      action: 'update',
      role: 'updated',
      targets: [{ taskId: undefined, taskIdentifier: 'T-9' }],
    });
  });

  it('resolves delete into a role-less plan keyed off state.taskId', () => {
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
