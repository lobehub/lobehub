import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addInputHistory,
  CHAT_INPUT_HISTORY_STORAGE_KEY,
  getInputHistory,
  getInputHistoryStorageKey,
} from './inputHistoryStorage';

describe('inputHistoryStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves and reads input history back in newest-first order', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    addInputHistory({ markdown: 'first prompt' });
    addInputHistory({
      json: { root: { children: [{ text: 'second prompt' }] } },
      markdown: 'second prompt',
    });

    expect(getInputHistory()).toEqual([
      {
        createdAt: 2000,
        json: { root: { children: [{ text: 'second prompt' }] } },
        markdown: 'second prompt',
      },
      { createdAt: 1000, markdown: 'first prompt' },
    ]);
  });

  it('ignores empty markdown', () => {
    addInputHistory({ markdown: '   ' });

    expect(localStorage.getItem(getInputHistoryStorageKey())).toBeNull();
    expect(getInputHistory()).toEqual([]);
  });

  it('isolates history by user and agent', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(3000);

    addInputHistory({ agentId: 'agent-1', markdown: 'user A prompt', userId: 'user-a' });
    addInputHistory({ agentId: 'agent-1', markdown: 'user B prompt', userId: 'user-b' });
    addInputHistory({ agentId: 'agent-2', markdown: 'user A agent 2 prompt', userId: 'user-a' });

    expect(getInputHistory({ agentId: 'agent-1', userId: 'user-a' })).toEqual([
      { createdAt: 1000, markdown: 'user A prompt' },
    ]);
    expect(getInputHistory({ agentId: 'agent-1', userId: 'user-b' })).toEqual([
      { createdAt: 2000, markdown: 'user B prompt' },
    ]);
    expect(getInputHistory({ agentId: 'agent-2', userId: 'user-a' })).toEqual([
      { createdAt: 3000, markdown: 'user A agent 2 prompt' },
    ]);
  });

  it('deduplicates by trimmed markdown and keeps the latest editor state', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    addInputHistory({ json: { v: 1 }, markdown: 'same prompt' });
    addInputHistory({ json: { v: 2 }, markdown: ' same prompt ' });

    expect(getInputHistory()).toEqual([
      { createdAt: 2000, json: { v: 2 }, markdown: ' same prompt ' },
    ]);
  });

  it('evicts the oldest entries beyond the 50 item cap', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));

    for (let i = 0; i < 55; i += 1) {
      addInputHistory({ markdown: `prompt-${i}` });
    }

    const history = getInputHistory();

    expect(history).toHaveLength(50);
    expect(history[0].markdown).toBe('prompt-54');
    expect(history.at(-1)?.markdown).toBe('prompt-5');
  });

  it('treats corrupt storage as empty and recovers on next write', () => {
    localStorage.setItem(getInputHistoryStorageKey(), '{not json');

    expect(getInputHistory()).toEqual([]);

    addInputHistory({ markdown: 'recovered prompt' });

    expect(getInputHistory()[0].markdown).toBe('recovered prompt');
  });

  it('drops malformed entries when reading', () => {
    localStorage.setItem(
      getInputHistoryStorageKey(),
      JSON.stringify([
        { createdAt: 1, markdown: 'good prompt' },
        { createdAt: 2, markdown: '   ' },
        { createdAt: 3, json: 'bad json', markdown: 'bad prompt' },
      ]),
    );

    expect(getInputHistory()).toEqual([{ createdAt: 1, markdown: 'good prompt' }]);
  });

  it('drops the legacy global key instead of reading it', () => {
    const legacyStorageKey = 'lobechat:chat-input-history:v1';

    localStorage.setItem(
      legacyStorageKey,
      JSON.stringify([{ createdAt: 1, markdown: 'legacy prompt' }]),
    );

    expect(getInputHistory({ agentId: 'agent-1', userId: 'user-a' })).toEqual([]);
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
    expect(localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
