import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildEditedTopicPreviousConversation } from './resumeReplay';

const msg = (over: Partial<UIChatMessage>): UIChatMessage =>
  ({ content: '', createdAt: 0, id: 'm', role: 'user', ...over }) as UIChatMessage;

describe('buildEditedTopicPreviousConversation', () => {
  it('serializes only the ancestors before the edited prompt', () => {
    const result = buildEditedTopicPreviousConversation(
      [
        msg({ content: 'first question', id: 'u0' }),
        msg({ content: 'sibling attempt', id: 'a0-old', parentId: 'u0', role: 'assistant' }),
        msg({ id: 'a0', parentId: 'u0', role: 'assistant', tools: [{ id: 'c' }] as any }),
        msg({ content: 'TOOL OUTPUT', id: 't0', parentId: 'a0', role: 'tool' }),
        msg({ content: 'first answer', id: 'a1', parentId: 't0', role: 'assistant' }),
        msg({ content: 'EDITED PROMPT', id: 'u1', parentId: 'a1' }),
        msg({ content: '...', id: 'run', parentId: 'u1', role: 'assistant' }),
      ],
      'run',
    );

    expect(result).toBe(
      [
        '<previous_conversation>',
        '<user>\nfirst question\n</user>',
        '<assistant>\nfirst answer\n</assistant>',
        '</previous_conversation>',
      ].join('\n'),
    );
  });

  it('keeps the newest 30 turns and truncates long turns like the gateway fallback', () => {
    const rows: UIChatMessage[] = [];
    let parentId: string | undefined;
    for (let i = 0; i < 40; i++) {
      const id = `m${i}`;
      rows.push(
        msg({
          content: i === 39 ? 'a'.repeat(3000) : `turn ${i}`,
          id,
          parentId,
          role: i % 2 ? 'assistant' : 'user',
        }),
      );
      parentId = id;
    }
    rows.push(msg({ content: 'edited', id: 'edit', parentId }));
    rows.push(msg({ id: 'run', parentId: 'edit', role: 'assistant' }));

    const result = buildEditedTopicPreviousConversation(rows, 'run')!;

    expect(result.match(/<(user|assistant)>/g)).toHaveLength(30);
    expect(result).not.toContain('turn 9\n');
    expect(result).toContain('turn 10\n');
    expect(result).toContain(`${'a'.repeat(2048)}… [truncated]`);
  });

  it('returns undefined without a user prompt or history', () => {
    expect(buildEditedTopicPreviousConversation(undefined, 'run')).toBeUndefined();
    expect(
      buildEditedTopicPreviousConversation(
        [msg({ id: 'u' }), msg({ id: 'run', parentId: 'u', role: 'assistant' })],
        'run',
      ),
    ).toBeUndefined();
  });
});
