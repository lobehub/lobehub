import { describe, expect, it } from 'vitest';

import {
  formatCollabStatus,
  getCollabAgentEntries,
  getCollabPrompt,
  getCollabStatusTone,
  getCollabToolName,
} from './collabToolUtils';

const spawnArgs = {
  agents_states: {},
  prompt: 'Return a single short line stating what 2 + 2 equals.',
  receiver_thread_ids: [],
  sender_thread_id: 'thread_parent',
  status: 'in_progress',
  tool: 'spawn_agent',
};

const waitState = {
  agents_states: {
    thread_a: { message: '2 + 2 = 4', status: 'completed' },
  },
  prompt: null,
  receiver_thread_ids: ['thread_a'],
  sender_thread_id: 'thread_parent',
  status: 'completed',
  tool: 'wait',
};

describe('getCollabToolName', () => {
  it('prefers the result state over call args', () => {
    expect(getCollabToolName(spawnArgs, waitState)).toBe('wait');
    expect(getCollabToolName(spawnArgs)).toBe('spawn_agent');
    expect(getCollabToolName()).toBe('');
  });
});

describe('getCollabPrompt', () => {
  it('falls back to args when the state prompt is null', () => {
    expect(getCollabPrompt(spawnArgs, waitState)).toBe(spawnArgs.prompt);
    expect(getCollabPrompt(undefined, waitState)).toBe('');
  });
});

describe('getCollabAgentEntries', () => {
  it('reads final agent states from the result state', () => {
    expect(getCollabAgentEntries(spawnArgs, waitState)).toEqual([
      { id: 'thread_a', message: '2 + 2 = 4', status: 'completed' },
    ]);
  });

  it('orders by receiver_thread_ids and appends extra state keys', () => {
    const entries = getCollabAgentEntries(undefined, {
      agents_states: {
        thread_b: { message: null, status: 'pending_init' },
        thread_extra: { message: 'done', status: 'completed' },
      },
      receiver_thread_ids: ['thread_b'],
      tool: 'spawn_agent',
    });

    expect(entries.map((entry) => entry.id)).toEqual(['thread_b', 'thread_extra']);
    expect(entries[0]).toEqual({ id: 'thread_b', message: undefined, status: 'pending_init' });
  });

  it('falls back to call args when the state has no agents', () => {
    expect(getCollabAgentEntries(spawnArgs, { agents_states: {}, tool: 'spawn_agent' })).toEqual(
      [],
    );

    const argsWithAgents = {
      ...spawnArgs,
      agents_states: { thread_c: { message: null, status: 'pending_init' } },
      receiver_thread_ids: ['thread_c'],
    };
    expect(getCollabAgentEntries(argsWithAgents, undefined)).toEqual([
      { id: 'thread_c', message: undefined, status: 'pending_init' },
    ]);
  });
});

describe('getCollabStatusTone', () => {
  it('maps codex agent statuses to tones', () => {
    expect(getCollabStatusTone('completed')).toBe('success');
    expect(getCollabStatusTone('errored')).toBe('error');
    expect(getCollabStatusTone('in_progress')).toBe('processing');
    expect(getCollabStatusTone('pending_init')).toBe('muted');
    expect(getCollabStatusTone()).toBe('muted');
  });
});

describe('formatCollabStatus', () => {
  it('humanizes snake_case statuses', () => {
    expect(formatCollabStatus('pending_init')).toBe('pending init');
    expect(formatCollabStatus()).toBe('');
  });
});
