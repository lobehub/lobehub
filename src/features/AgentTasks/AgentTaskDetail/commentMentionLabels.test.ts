import { describe, expect, it } from 'vitest';

import { collectMentionLabels } from './commentMentionLabels';

describe('collectMentionLabels', () => {
  it('maps every mentioned id to the label the editor shows', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              { label: 'Coder', metadata: { id: 'agt_1', type: 'agent' }, type: 'mention' },
              { text: ' and ', type: 'text' },
              { label: 'Ada', metadata: { id: 'user_1', type: 'member' }, type: 'mention' },
            ],
            type: 'paragraph',
          },
        ],
      },
    };

    expect(collectMentionLabels(editorData)).toEqual(
      new Map([
        ['agt_1', 'Coder'],
        ['user_1', 'Ada'],
      ]),
    );
  });

  it('returns nothing for a snapshot without mentions or no snapshot at all', () => {
    expect(collectMentionLabels(undefined).size).toBe(0);
    expect(collectMentionLabels({ root: { children: [] } }).size).toBe(0);
  });
});
