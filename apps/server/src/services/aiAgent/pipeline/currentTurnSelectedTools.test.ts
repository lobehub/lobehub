import { describe, expect, it, vi } from 'vitest';

import {
  collectCurrentTurnSelectedToolIds,
  idsForExplicitActivationRecheck,
  resolveTurnSelectedToolIds,
} from './currentTurnSelectedTools';

const user = (selectedToolIds?: string[], extra?: Record<string, unknown>) => ({
  metadata: { ...extra, ...(selectedToolIds ? { selectedToolIds } : {}) },
  role: 'user' as const,
});

describe('collectCurrentTurnSelectedToolIds', () => {
  it('keeps the mention on the turn that is resuming', () => {
    expect(
      collectCurrentTurnSelectedToolIds([
        user(['yingmi']),
        { role: 'assistant' },
        { role: 'tool' },
      ]),
    ).toEqual(['yingmi']);
  });

  it('keeps a mention made on a steer of the same turn', () => {
    expect(
      collectCurrentTurnSelectedToolIds([
        user(['yingmi']),
        { role: 'assistant' },
        user(['other'], { steer: true }),
      ]),
    ).toEqual(['yingmi', 'other']);
  });

  it('drops the mention once the next user turn starts', () => {
    expect(
      collectCurrentTurnSelectedToolIds([
        user(['yingmi']),
        { role: 'assistant' },
        user(),
        { role: 'assistant' },
      ]),
    ).toEqual([]);
  });

  it('ignores a mention on a bot-channel or external-origin message', () => {
    expect(
      collectCurrentTurnSelectedToolIds([
        user(['yingmi']),
        user(['from-bot'], { botSender: { id: 'bot', platform: 'slack' } }),
      ]),
    ).toEqual([]);
    expect(
      collectCurrentTurnSelectedToolIds([
        user(['from-event'], { externalOrigin: { source: 'webhook' } }),
      ]),
    ).toEqual([]);
  });

  it('ignores assistant rows and non-string ids', () => {
    expect(
      collectCurrentTurnSelectedToolIds([
        { metadata: { selectedToolIds: ['from-assistant'] }, role: 'assistant' },
        { metadata: { selectedToolIds: [42, '', 'kept'] }, role: 'user' },
      ]),
    ).toEqual(['kept']);
  });
});

describe('resolveTurnSelectedToolIds', () => {
  it('reads the persisted mention when the resume has no new user row', async () => {
    const loadHistoryMessages = vi
      .fn()
      .mockResolvedValue([user(['yingmi']), { role: 'assistant' }]);

    await expect(resolveTurnSelectedToolIds({ loadHistoryMessages })).resolves.toEqual(['yingmi']);
  });

  it('uses this request’s mention on a new user turn and leaves the previous turn unread', async () => {
    const loadHistoryMessages = vi.fn().mockResolvedValue([user(['yingmi'])]);

    await expect(
      resolveTurnSelectedToolIds({
        loadHistoryMessages,
        selectedToolIds: ['fresh'],
        userMessageMetadata: { trigger: 'chat' },
      }),
    ).resolves.toEqual(['fresh']);
    expect(loadHistoryMessages).not.toHaveBeenCalled();
  });

  it('does not inherit the previous turn when the prompt was never persisted', async () => {
    const loadHistoryMessages = vi.fn().mockResolvedValue([user(['yingmi'])]);

    await expect(
      resolveTurnSelectedToolIds({ ephemeralTurn: true, loadHistoryMessages }),
    ).resolves.toEqual([]);
    expect(loadHistoryMessages).not.toHaveBeenCalled();
  });

  it('keeps the running turn’s mention when a steer continues it', async () => {
    const loadHistoryMessages = vi.fn().mockResolvedValue([user(['yingmi'])]);

    await expect(
      resolveTurnSelectedToolIds({
        loadHistoryMessages,
        selectedToolIds: ['from-steer'],
        userMessageMetadata: { selectedToolIds: ['from-steer'], steer: true },
      }),
    ).resolves.toEqual(['from-steer', 'yingmi']);
  });
});

describe('idsForExplicitActivationRecheck', () => {
  it('re-checks this turn’s mention together with tools activated earlier', () => {
    expect(
      idsForExplicitActivationRecheck(
        [user(['yingmi']), { role: 'assistant' }],
        ['lobe-task'],
        ['yingmi'],
      ),
    ).toEqual(['lobe-task', 'yingmi']);
  });

  it('stops re-checking the mention on the next user turn and still restores activations', () => {
    expect(
      idsForExplicitActivationRecheck([user(['yingmi']), user()], ['lobe-task'], ['yingmi']),
    ).toEqual(['lobe-task']);
  });

  it('does not re-check a mention from a bot or external-origin message', () => {
    expect(
      idsForExplicitActivationRecheck(
        [user(['yingmi'], { botSender: { id: 'bot', platform: 'slack' } })],
        [],
        ['yingmi'],
      ),
    ).toEqual([]);
    expect(
      idsForExplicitActivationRecheck(
        [user(['yingmi'], { externalOrigin: { source: 'webhook' } })],
        [],
        ['yingmi'],
      ),
    ).toEqual([]);
  });

  it('leaves out a mention discovery did not accept', () => {
    expect(idsForExplicitActivationRecheck([user(['yingmi'])], [], ['pinned-only'])).toEqual([]);
  });
});
