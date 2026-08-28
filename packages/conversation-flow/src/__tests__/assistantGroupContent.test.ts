import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type {
  AssistantGroupAnswerSegment,
  AssistantGroupWorkflowSegment,
} from '../assistantGroupContent';
import {
  isAssistantGroupStatusText,
  partitionAssistantGroupBlocks,
  resolveAssistantGroupFinalContent,
  splitAssistantGroupFinalAnswer,
} from '../assistantGroupContent';

type BlockOptions = Partial<Omit<AssistantContentBlock, 'content' | 'id'>>;

const tool = (id: string) =>
  ({ apiName: 'testTool', id }) as NonNullable<AssistantContentBlock['tools']>[number];

const block = (id: string, content: string, options: BlockOptions = {}): AssistantContentBlock => ({
  content,
  id,
  ...options,
});

const answerSegment = (id: string, content = 'answer'): AssistantGroupAnswerSegment => ({
  block: block(id, content),
  kind: 'answer',
});

const workflowSegment = (id: string): AssistantGroupWorkflowSegment => ({
  blocks: [block(id, '', { tools: [tool(`${id}-tool`)] })],
  kind: 'workflow',
});

const group = (
  children: AssistantContentBlock[],
  taskCompletions?: AssistantContentBlock[],
): UIChatMessage => ({
  children,
  content: '',
  createdAt: 0,
  id: 'assistant-group',
  role: 'assistantGroup',
  taskCompletions,
  updatedAt: 0,
});

describe('isAssistantGroupStatusText', () => {
  it('classifies only short, unstructured single-line prose as workflow status', () => {
    expect(isAssistantGroupStatusText('Now I will update the issue.')).toBe(true);
    expect(isAssistantGroupStatusText('Updated src/a.ts successfully.')).toBe(true);
    expect(isAssistantGroupStatusText('Upgraded to Node.js 24.')).toBe(true);

    expect(isAssistantGroupStatusText('First sentence. Second sentence.')).toBe(false);
    expect(isAssistantGroupStatusText('Summary\n\nMore detail')).toBe(false);
    expect(isAssistantGroupStatusText('## Result')).toBe(false);
    expect(isAssistantGroupStatusText('- Result')).toBe(false);
    expect(isAssistantGroupStatusText('x'.repeat(101))).toBe(false);
  });

  it.each(['第一句话。第二句话。', '第一句话！第二句话！', '第一句话？第二句话？'])(
    'recognizes CJK sentence boundaries in %s',
    (content) => {
      expect(isAssistantGroupStatusText(content)).toBe(false);
    },
  );
});

describe('partitionAssistantGroupBlocks', () => {
  it('keeps a single-tool mixed block in workflow and the earlier answer final', () => {
    const answer = block('answer', 'This is the visible final answer.');
    const mixedTool = block(
      'mixed-tool',
      'This long tool narration has multiple sentences. It remains workflow content.',
      { tools: [tool('only-tool')] },
    );
    const { segments } = partitionAssistantGroupBlocks([answer, mixedTool], {
      isGenerating: false,
    });

    expect(segments.map(({ kind }) => kind)).toEqual(['answer', 'workflow']);
    expect(segments[1]).toMatchObject({
      blocks: [{ content: mixedTool.content, id: mixedTool.id }],
      kind: 'workflow',
    });
    expect(splitAssistantGroupFinalAnswer(segments).finalSegments).toEqual([
      { block: answer, kind: 'answer' },
    ]);
  });

  it('projects answer-like mixed content out of a multi-tool workflow', () => {
    const detailedAnswer =
      'The migration is complete. All affected paths now share the same invariant.';
    const { segments } = partitionAssistantGroupBlocks(
      [
        block('status', 'I will inspect the code.', { tools: [tool('read-call')] }),
        block('answer-with-tool', detailedAnswer, { tools: [tool('update-call')] }),
      ],
      { isGenerating: false },
    );

    expect(segments.map(({ kind }) => kind)).toEqual(['workflow', 'answer', 'workflow']);
    expect(segments[1]).toMatchObject({
      block: {
        content: detailedAnswer,
        id: 'answer-with-tool',
        projection: 'answer',
        tools: undefined,
      },
      kind: 'answer',
    });
    expect(segments[2]).toMatchObject({
      blocks: [
        {
          content: '',
          id: 'answer-with-tool',
          projection: 'workflow',
          tools: [expect.objectContaining({ id: 'update-call' })],
        },
      ],
      kind: 'workflow',
    });
  });

  it('promotes a substantive post-tool answer as soon as the tool phase settles', () => {
    const { postToolTailPromoted, segments } = partitionAssistantGroupBlocks(
      [
        block('tool-step', 'Searching.', { tools: [tool('search-call')] }),
        block('answer', 'The search is complete. Here are the results.'),
      ],
      { isGenerating: true, toolsPhaseComplete: true },
    );

    expect(postToolTailPromoted).toBe(true);
    expect(segments.map(({ kind }) => kind)).toEqual(['workflow', 'answer']);
  });

  it('keeps a short post-tool status in workflow while generating', () => {
    const { postToolTailPromoted, segments } = partitionAssistantGroupBlocks(
      [
        block('tool-step', 'Searching.', { tools: [tool('search-call')] }),
        block('status', 'Now I will summarize the results.'),
      ],
      { isGenerating: true, toolsPhaseComplete: true },
    );

    expect(postToolTailPromoted).toBe(false);
    expect(segments.map(({ kind }) => kind)).toEqual(['workflow']);
  });
});

describe('splitAssistantGroupFinalAnswer', () => {
  it('keeps only the last answer run outside the process', () => {
    const segments = [
      workflowSegment('tool-1'),
      answerSegment('intro'),
      workflowSegment('tool-2'),
      answerSegment('final-1'),
      answerSegment('final-2'),
    ];
    const { processSegments, finalSegments } = splitAssistantGroupFinalAnswer(segments);

    expect(processSegments).toEqual([
      workflowSegment('tool-1'),
      answerSegment('intro'),
      workflowSegment('tool-2'),
    ]);
    expect(finalSegments).toEqual([answerSegment('final-1'), answerSegment('final-2')]);
  });

  it('keeps the final answer visible before a trailing bookkeeping workflow', () => {
    const summary = answerSegment('summary');
    const trailingWorkflow = workflowSegment('mark-done');
    const { processSegments, finalSegments } = splitAssistantGroupFinalAnswer([
      workflowSegment('tool-1'),
      summary,
      trailingWorkflow,
    ]);

    expect(processSegments).toEqual([workflowSegment('tool-1'), trailingWorkflow]);
    expect(finalSegments).toEqual([summary]);
  });

  it('returns no final answer for a workflow-only group', () => {
    const segments = [workflowSegment('tool-1'), workflowSegment('tool-2')];

    expect(splitAssistantGroupFinalAnswer(segments)).toEqual({
      finalSegments: [],
      processSegments: segments,
    });
  });

  it('treats a pure-answer turn as entirely final', () => {
    const segments = [answerSegment('only')];

    expect(splitAssistantGroupFinalAnswer(segments)).toEqual({
      finalSegments: segments,
      processSegments: [],
    });
  });
});

describe('resolveAssistantGroupFinalContent', () => {
  it('skips a trailing tool status and keeps the answer rendered before it', () => {
    const message = group([
      block('answer', 'This is the actual answer.'),
      block('status', 'Now I will update the issue.', { tools: [tool('tool-call')] }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('This is the actual answer.');
  });

  it('uses shared single-tool semantics instead of treating mixed tool prose as final', () => {
    const message = group([
      block('answer', 'This is the answer outside the workflow.'),
      block(
        'mixed-tool',
        'This long tool narration has multiple sentences. It remains workflow content.',
        { tools: [tool('only-tool')] },
      ),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe(
      'This is the answer outside the workflow.',
    );
  });

  it('uses an earlier answer when the final answer run contains only an error', () => {
    const message = group([
      block('answer', 'This is the actual answer.'),
      block('status', 'Now I will update the issue.', { tools: [tool('tool-call')] }),
      block('error', '', {
        error: {
          message: 'The follow-up failed.',
          type: 'ProviderBizError',
        },
      }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('This is the actual answer.');
  });

  it('keeps answer-like prose projected from a multi-tool mixed block', () => {
    const detailedAnswer =
      'The migration is complete. All affected paths now share the same invariant.';
    const message = group([
      block('status', 'I will inspect the code.', { tools: [tool('read-call')] }),
      block('answer-with-tool', detailedAnswer, { tools: [tool('update-call')] }),
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
      block('status-1', 'Checking the repository.', { tools: [tool('search-call')] }),
      block('status-2', 'Updating the repository.', { tools: [tool('edit-call')] }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('Updating the repository.');
  });
});
