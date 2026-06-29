import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addInputHistory,
  CHAT_INPUT_HISTORY_STORAGE_KEY,
  getInputHistory,
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

    expect(localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(getInputHistory()).toEqual([]);
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
    localStorage.setItem(CHAT_INPUT_HISTORY_STORAGE_KEY, '{not json');

    expect(getInputHistory()).toEqual([]);

    addInputHistory({ markdown: 'recovered prompt' });

    expect(getInputHistory()[0].markdown).toBe('recovered prompt');
  });

  it('drops malformed entries when reading', () => {
    localStorage.setItem(
      CHAT_INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { createdAt: 1, markdown: 'good prompt' },
        { createdAt: 2, markdown: '   ' },
        { createdAt: 3, json: 'bad json', markdown: 'bad prompt' },
      ]),
    );

    expect(getInputHistory()).toEqual([{ createdAt: 1, markdown: 'good prompt' }]);
  });
});
