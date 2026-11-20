import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveCompressedMessageView } from './resolveCompressedMessageView';

const message = (input: Partial<UIChatMessage> & { role: string }) =>
  input as Pick<UIChatMessage, 'children' | 'role'>;

describe('resolveCompressedMessageView', () => {
  it('sends an assistant group with tool steps through the folded turn renderer', () => {
    // Regression: the history view rendered these blocks one by one, expanding
    // every reasoning and tool step of the compressed turn at once. It must use
    // the same chain renderer as the conversation, which folds the process.
    const turn = message({
      children: [
        { content: 'Running the checks.', id: 'block-1', tools: [{ id: 'tool-1' } as any] } as any,
        { content: 'Here is the final answer.', id: 'block-2' } as any,
      ],
      role: 'assistantGroup',
    });

    expect(resolveCompressedMessageView(turn)).toBe('assistant-turn-chain');
  });

  it('keeps a tool-less assistant message on the plain content renderer', () => {
    expect(resolveCompressedMessageView(message({ content: 'Answer', role: 'assistant' }))).toBe(
      'assistant-content',
    );
  });

  it('renders user messages with the shared user renderer', () => {
    expect(resolveCompressedMessageView(message({ content: 'Question', role: 'user' }))).toBe(
      'user',
    );
  });

  it('renders nothing for roles the history view does not carry', () => {
    expect(resolveCompressedMessageView(message({ role: 'tool' }))).toBe('none');
    expect(resolveCompressedMessageView(message({ role: 'system' }))).toBe('none');
    // An assistant group without projected blocks has nothing to show.
    expect(resolveCompressedMessageView(message({ role: 'assistantGroup' }))).toBe('none');
  });
});
