import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  isAssistantGroupStatusText,
  resolveAssistantGroupFinalContent,
} from '../assistantGroupContent';

const block = (
  id: string,
  content: string,
  options: Pick<AssistantContentBlock, 'tools'> = {},
): AssistantContentBlock => ({ content, id, ...options });

const group = (
  children: AssistantContentBlock[],
  taskCompletions?: AssistantContentBlock[],
): UIChatMessage =>
  ({
    children,
    content: '',
    createdAt: 0,
    id: 'assistant-group',
    role: 'assistantGroup',
    taskCompletions,
    updatedAt: 0,
  }) as UIChatMessage;

describe('isAssistantGroupStatusText', () => {
  it('classifies only short, unstructured single-line prose as workflow status', () => {
    expect(isAssistantGroupStatusText('Now I will update the issue.')).toBe(true);
    expect(isAssistantGroupStatusText('Updated src/a.ts successfully.')).toBe(true);

    expect(isAssistantGroupStatusText('First sentence. Second sentence.')).toBe(false);
    expect(isAssistantGroupStatusText('Summary\n\nMore detail')).toBe(false);
    expect(isAssistantGroupStatusText('## Result')).toBe(false);
    expect(isAssistantGroupStatusText('- Result')).toBe(false);
    expect(isAssistantGroupStatusText('x'.repeat(101))).toBe(false);
  });
});

describe('resolveAssistantGroupFinalContent', () => {
  it('skips a trailing tool status and keeps the answer rendered before it', () => {
    const message = group([
      block('answer', 'This is the actual answer.'),
      block('status', 'Now I will update the issue.', {
        tools: [{ apiName: 'updateIssue', id: 'tool-call' } as any],
      }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('This is the actual answer.');
  });

  it('keeps answer-like prose from a mixed tool block', () => {
    const detailedAnswer =
      'The migration is complete. All affected paths now share the same invariant.';
    const message = group([
      block('status', 'I will inspect the code.', {
        tools: [{ apiName: 'readFile', id: 'read-call' } as any],
      }),
      block('answer-with-tool', detailedAnswer, {
        tools: [{ apiName: 'updateIssue', id: 'update-call' } as any],
      }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe(detailedAnswer);
  });

  it('prefers the last post-task summary over the main assistant chain', () => {
    const message = group(
      [block('main-answer', 'Initial answer')],
      [block('summary-1', 'First task summary'), block('summary-2', 'Final task summary')],
    );

    expect(resolveAssistantGroupFinalContent(message)).toBe('Final task summary');
  });

  it('falls back to the latest authored status for a status-only group', () => {
    const message = group([
      block('status-1', 'Checking the repository.', {
        tools: [{ apiName: 'search', id: 'search-call' } as any],
      }),
      block('status-2', 'Updating the repository.', {
        tools: [{ apiName: 'edit', id: 'edit-call' } as any],
      }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('Updating the repository.');
  });
});
