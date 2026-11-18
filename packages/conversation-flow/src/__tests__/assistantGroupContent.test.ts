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

const group = (children: AssistantContentBlock[]): UIChatMessage => ({
  children,
  content: '',
  createdAt: 0,
  id: 'assistant-group',
  role: 'assistantGroup',
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
  const narration = [
    '正在读 0.7 版和 cc-switch 的额度查询实现，对照出 Claude、Codex、OpenCode 三家各自的取数接口，然后定实现方案。',
    '代码结构已摸清，正在核对 OpenCode 凭据的存放形式，随后把实现拆成工作包交给 Weaver 派发。',
  ];
  const realSteps = () => [
    block('step-1', '', { tools: [tool('a'), tool('b'), tool('c')] }),
    block('step-2', '', { tools: [tool('d'), tool('e')] }),
    block('step-3', narration[0]!, { tools: [tool('f'), tool('g')] }),
    block('step-4', '', { tools: [tool('h'), tool('i')] }),
    block('step-5', narration[1]!, { tools: [tool('j')] }),
  ];

  it.each([true, false])(
    'splits real tool narration into answers (generating=%s)',
    (isGenerating) => {
      const final = block(
        'step-6',
        '## 实现完成\n\n已接入三家额度接口。\n\n- Claude\n- Codex\n- OpenCode',
      );
      const { segments } = partitionAssistantGroupBlocks([...realSteps(), final], {
        isGenerating,
        toolsPhaseComplete: true,
      });
      expect(segments.map(({ kind }) => kind)).toEqual([
        'workflow',
        'answer',
        'workflow',
        'answer',
        'workflow',
        'answer',
      ]);
      expect(
        segments.flatMap((segment) =>
          segment.kind === 'workflow'
            ? [segment.blocks.reduce((sum, entry) => sum + (entry.tools?.length ?? 0), 0)]
            : [],
        ),
      ).toEqual([5, 4, 1]);
      expect(
        segments.flatMap((segment) => (segment.kind === 'answer' ? [segment.block.content] : [])),
      ).toEqual([...narration, final.content]);
    },
  );

  it.each([true, false])(
    'uses the last narration as final when a turn ends on tools (generating=%s)',
    (isGenerating) => {
      const { postToolTailPromoted, segments } = partitionAssistantGroupBlocks(realSteps(), {
        isGenerating,
        toolsPhaseComplete: true,
      });
      expect(postToolTailPromoted).toBe(false);
      expect(segments.map(({ kind }) => kind)).toEqual([
        'workflow',
        'answer',
        'workflow',
        'answer',
        'workflow',
      ]);
      expect(splitAssistantGroupFinalAnswer(segments).finalSegments).toEqual([
        expect.objectContaining({
          block: expect.objectContaining({ content: narration[1] }),
          kind: 'answer',
        }),
      ]);
    },
  );

  it.each([true, false])(
    'promotes long pure prose between tools without an empty workflow (generating=%s)',
    (isGenerating) => {
      const prose =
        'The implementation has been inspected. '.repeat(5) + '\n\nNext, verify the credentials.';
      const { segments } = partitionAssistantGroupBlocks(
        [
          block('first', '', { tools: [tool('a')] }),
          block('prose', prose, { reasoning: { content: 'Inspecting credentials' } }),
          block('last', '', { tools: [tool('b')] }),
        ],
        { isGenerating },
      );
      expect(segments.map(({ kind }) => kind)).toEqual(['workflow', 'answer', 'workflow']);
      expect(segments[1]).toMatchObject({
        block: { content: prose, tools: undefined, error: undefined },
      });
      expect(segments[2]).toMatchObject({ blocks: [{ id: 'last' }] });
    },
  );

  it.each(['', '...', '   '])('does not promote a placeholder %j', (content) => {
    const { segments } = partitionAssistantGroupBlocks(
      [block('first', content, { tools: [tool('a'), tool('b')] })],
      { isGenerating: true },
    );
    expect(segments.map(({ kind }) => kind)).toEqual(['workflow']);
  });

  it.each([true, false])(
    'keeps a single-tool mixed block in workflow and the earlier answer final (generating=%s)',
    (isGenerating) => {
      const answer = block('answer', 'This is the visible final answer.');
      const mixedTool = block(
        'mixed-tool',
        'This long tool narration has multiple sentences. It remains workflow content.',
        { tools: [tool('only-tool')] },
      );
      const { segments } = partitionAssistantGroupBlocks([answer, mixedTool], {
        isGenerating,
      });

      expect(segments.map(({ kind }) => kind)).toEqual(['answer', 'workflow']);
      expect(segments[1]).toMatchObject({
        blocks: [{ content: mixedTool.content, id: mixedTool.id }],
        kind: 'workflow',
      });
      expect(splitAssistantGroupFinalAnswer(segments).finalSegments).toEqual([
        { block: answer, kind: 'answer' },
      ]);
    },
  );

  it('projects short narration and answer-like mixed content out of a multi-tool workflow', () => {
    const detailedAnswer =
      'The migration is complete. All affected paths now share the same invariant.';
    const { segments } = partitionAssistantGroupBlocks(
      [
        block('status', 'I will inspect the code.', { tools: [tool('read-call')] }),
        block('answer-with-tool', detailedAnswer, { tools: [tool('update-call')] }),
      ],
      { isGenerating: false },
    );

    expect(segments.map(({ kind }) => kind)).toEqual(['answer', 'workflow', 'answer', 'workflow']);
    expect(segments[0]).toMatchObject({
      block: { content: 'I will inspect the code.', tools: undefined },
      kind: 'answer',
    });
    expect(segments[2]).toMatchObject({
      block: {
        content: detailedAnswer,
        id: 'answer-with-tool',
        projection: 'answer',
        tools: undefined,
      },
      kind: 'answer',
    });
    expect(segments[3]).toMatchObject({
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

  it('breaks a breakout tool out of the workflow as its own standalone segment', () => {
    const isBreakoutTool = (candidate: { id: string }) => candidate.id === 'read-image';
    const { segments } = partitionAssistantGroupBlocks(
      [
        block('step-1', 'Looking.', { tools: [tool('bash-1')] }),
        block('step-2', 'Checking the screenshot.', {
          reasoning: { content: 'thinking' },
          tools: [tool('bash-2'), tool('read-image'), tool('bash-3')],
        }),
        block('step-3', '', { tools: [tool('bash-4')] }),
      ],
      { isBreakoutTool, isGenerating: false },
    );

    expect(segments.map(({ kind }) => kind)).toEqual([
      'answer',
      'workflow',
      'answer',
      'workflow',
      'workflow',
      'workflow',
    ]);
    expect(segments[0]).toMatchObject({
      block: { content: 'Looking.', tools: undefined },
      kind: 'answer',
    });
    expect(segments[1]).toMatchObject({
      blocks: [{ id: 'step-1', content: '' }],
      kind: 'workflow',
    });
    expect(segments[2]).toMatchObject({
      block: {
        content: 'Checking the screenshot.',
        reasoning: { content: 'thinking' },
        tools: undefined,
      },
      kind: 'answer',
    });
    expect(segments[3]).toMatchObject({
      blocks: [
        {
          content: '',
          id: 'step-2',
          projection: 'workflow',
          reasoning: undefined,
          tools: [expect.objectContaining({ id: 'bash-2' })],
        },
      ],
      kind: 'workflow',
    });
    expect(segments[4]).toMatchObject({
      blocks: [
        {
          content: '',
          id: 'step-2',
          projection: 'workflow',
          reasoning: undefined,
          tools: [expect.objectContaining({ id: 'read-image' })],
        },
      ],
      kind: 'workflow',
      standalone: true,
    });
    expect(segments[5]).toMatchObject({
      blocks: [
        {
          content: '',
          id: 'step-2',
          projection: 'workflow',
          tools: [expect.objectContaining({ id: 'bash-3' })],
        },
        { id: 'step-3' },
      ],
      kind: 'workflow',
    });
    expect(
      segments.flatMap((segment) =>
        segment.kind === 'workflow' ? segment.blocks.map((b) => b.projectionKey) : [],
      ),
    ).toEqual([undefined, 'step-2__bash-2', 'step-2__read-image', 'step-2__bash-3', undefined]);
  });

  it('keeps a workflow block carrying images standalone', () => {
    const { segments } = partitionAssistantGroupBlocks(
      [
        block('step-1', '', { tools: [tool('bash-1')] }),
        block('step-2', '', {
          imageList: [{ alt: 'img', id: 'img', url: 'https://x/img.png' }],
          tools: [tool('bash-2')],
        }),
        block('step-3', '', { tools: [tool('bash-3')] }),
      ],
      { isGenerating: false },
    );

    expect(segments.map((segment) => segment.kind === 'workflow' && !!segment.standalone)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('does not break out a breakout tool from a single-tool turn', () => {
    const { segments } = partitionAssistantGroupBlocks(
      [block('step-1', 'Reading.', { tools: [tool('read-image')] })],
      { isBreakoutTool: () => true, isGenerating: false },
    );

    expect(segments).toEqual([
      { blocks: [block('step-1', 'Reading.', { tools: [tool('read-image')] })], kind: 'workflow' },
    ]);
  });

  it('keeps short post-tool status inside a single-tool workflow while generating', () => {
    const { postToolTailPromoted, segments } = partitionAssistantGroupBlocks(
      [
        block('tool', 'Searching.', { tools: [tool('search')] }),
        block('status', 'Now I will summarize the results.'),
      ],
      { isGenerating: true, toolsPhaseComplete: true },
    );
    expect(postToolTailPromoted).toBe(false);
    expect(segments).toEqual([
      {
        kind: 'workflow',
        blocks: [
          block('tool', 'Searching.', { tools: [tool('search')] }),
          block('status', 'Now I will summarize the results.'),
        ],
      },
    ]);
  });

  it('shows short post-tool narration without marking the final answer promoted while generating', () => {
    const { postToolTailPromoted, segments } = partitionAssistantGroupBlocks(
      [
        block('tool-step', '', { tools: [tool('search-call'), tool('read-call')] }),
        block('status', 'Now I will summarize the results.'),
      ],
      { isGenerating: true, toolsPhaseComplete: true },
    );

    expect(postToolTailPromoted).toBe(false);
    expect(segments.map(({ kind }) => kind)).toEqual(['workflow', 'answer']);
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

  it('falls back to the latest authored status for a status-only group', () => {
    const message = group([
      block('status-1', 'Checking the repository.', { tools: [tool('search-call')] }),
      block('status-2', 'Updating the repository.', { tools: [tool('edit-call')] }),
    ]);

    expect(resolveAssistantGroupFinalContent(message)).toBe('Updating the repository.');
  });
});
