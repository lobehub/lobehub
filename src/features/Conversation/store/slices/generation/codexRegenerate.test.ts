import type { UIChatMessage } from '@lobechat/types';
import { HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildCodexRegenerateContext } from './codexRegenerate';

const message = (fields: Partial<UIChatMessage> & Pick<UIChatMessage, 'id' | 'role'>) =>
  ({ content: '', createdAt: 1, updatedAt: 1, ...fields }) as UIChatMessage;

const selected = message({ content: 'Regenerate me', id: 'u-selected', role: 'user' });

describe('buildCodexRegenerateContext', () => {
  it('replays text turns, tool names and summaries without tool payloads', () => {
    const context = buildCodexRegenerateContext(
      [
        message({ content: 'Summary text', id: 'c0', role: 'compressedGroup' }),
        message({ content: 'EARLY-CODE', id: 'u0', role: 'user' }),
        message({
          children: [
            {
              content: 'Reading the file',
              id: 'a0',
              tools: [{ apiName: 'readFile', arguments: '{}', id: 'call-1' } as any],
            },
            { content: 'Done reading', id: 'a1' },
          ],
          id: 'a0',
          role: 'assistantGroup',
        }),
      ],
      selected,
    )!;

    expect(context).toContain('Summary of earlier conversation:\nSummary text');
    expect(context).toContain('<user>\nEARLY-CODE\n</user>');
    expect(context).toContain('Reading the file\n[Tool calls: readFile]\nDone reading');
  });

  it('bounds a long history and reduces historical images to a count', () => {
    const history = Array.from({ length: 200 }, (_, i) => [
      message({
        content: `turn-${i}`,
        id: `u${i}`,
        imageList: [{ alt: '', id: `img-${i}`, url: `https://x/${i}.png` }],
        role: 'user',
      }),
      message({ content: 'x'.repeat(20_000), id: `a${i}`, role: 'assistant' }),
    ]).flat();

    const context = buildCodexRegenerateContext(history, selected)!;

    expect(context.length).toBeLessThan(40_000);
    expect(context).toContain('turn-199\n[1 image(s)]');
    expect(context).not.toContain('turn-0\n');
    expect(context).not.toContain('https://x/');
  });

  it('includes the selected message attachments and selections', () => {
    const context = buildCodexRegenerateContext(
      [],
      message({
        content: 'Regenerate me',
        fileList: [{ id: 'file-1', name: 'notes.md' } as any],
        id: 'u-selected',
        role: 'user',
      }),
    )!;

    expect(context).not.toContain('<previous_conversation>');
    expect(context).toContain('Current user attachments: [{"id":"file-1","name":"notes.md"}]');
  });

  it('caps oversized current attachments at the server transport limit', () => {
    const context = buildCodexRegenerateContext(
      [],
      message({
        content: 'Regenerate me',
        fileList: [{ content: 'z'.repeat(300_000), id: 'file-1', name: 'big.txt' } as any],
        id: 'u-selected',
        role: 'user',
      }),
    )!;

    expect(context.length).toBe(HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH);
    expect(context.endsWith('… [truncated]')).toBe(true);
  });

  it('returns undefined when there is nothing to add', () => {
    expect(buildCodexRegenerateContext([], selected)).toBeUndefined();
  });
});
