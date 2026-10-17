import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';
import type { ChatToolPayloadWithResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import { buildChainView } from './groupChain';
import type { GroupRenderSegment } from './segments';
import { countAssistantLlmCalls, shouldFoldProcess } from './segments';

const tool = (id: string, interactive = false): ChatToolPayloadWithResult =>
  ({
    apiName: interactive ? 'renderUI' : 'search',
    arguments: '{}',
    id,
    identifier: interactive ? 'lobe-interactive-ui' : 'lobe-web-browsing',
    type: 'builtin',
  }) as ChatToolPayloadWithResult;

const block = (id: string, tools: ChatToolPayloadWithResult[], content = '') =>
  ({ content, id, tools }) as AssistantContentBlock;

const view = (blocks: AssistantContentBlock[], isGenerating = false) =>
  buildChainView({ blocks, id: 'group' }, { hasActiveOperation: isGenerating, isGenerating });

const blocksIn = (segments: GroupRenderSegment[]) =>
  segments.flatMap((segment) => (segment.kind === 'answer' ? [segment.block] : segment.blocks));

const callsIn = (segments: GroupRenderSegment[]) =>
  blocksIn(segments).flatMap((item) => item.tools?.map((call) => call.id) ?? []);

describe('interactive UI deliverable segmentation', () => {
  it('keeps a lone call in the same visible slot as it streams, settles, and gains later steps', () => {
    const call = tool('app', true);
    const streaming = view([block('step', [call])], true);
    const finishedCall = { ...call, result: { content: 'Created', id: 'result' } };
    const completed = view([
      block('step', [finishedCall]),
      block('later-step', [tool('search')]),
      block('final', [], 'Here is the result.'),
    ]);

    const pendingSlot = streaming.segments.find((segment) => segment.preserveOutsideProcessFold)!;
    const finishedSlot = completed.segments.find((segment) => segment.preserveOutsideProcessFold)!;
    expect(pendingSlot).toMatchObject({ kind: 'workflow', standalone: true });
    expect(blocksIn([pendingSlot])[0]?.renderKey).toBe(blocksIn([finishedSlot])[0]?.renderKey);
    expect(callsIn([pendingSlot])).toEqual(['app']);
    expect(callsIn(completed.segments)).toEqual(['app', 'search']);
    expect(streaming.showTailRunningIndicator).toBe(false);
  });

  it('splits mixed parallel calls without duplicating tools, narration, or reasoning', () => {
    const source = {
      ...block('mixed', [
        tool('search-1'),
        tool('app-1', true),
        tool('search-2'),
        tool('app-2', true),
      ]),
      content: 'Building the comparison.',
      reasoning: { content: 'Choose a useful layout.' },
    };
    const { segments } = view([source, block('final', [], 'Ready.')]);
    const deliverables = segments.filter((segment) => segment.preserveOutsideProcessFold);
    const process = segments.filter((segment) => !segment.preserveOutsideProcessFold);

    expect(callsIn(segments)).toEqual(['search-1', 'app-1', 'search-2', 'app-2']);
    expect(deliverables).toHaveLength(2);
    expect(callsIn(process)).toEqual(['search-1', 'search-2']);
    expect(blocksIn(deliverables).every((item) => !item.reasoning && !item.content)).toBe(true);
    expect(blocksIn(segments).filter((item) => item.content === source.content)).toHaveLength(1);
    expect(blocksIn(segments).filter((item) => item.reasoning)).toHaveLength(1);
    expect(countAssistantLlmCalls(segments)).toBe(2);
    expect(source.tools).toHaveLength(4);

    const {
      finalSegments,
      processSegments,
    }: {
      finalSegments: GroupRenderSegment[];
      processSegments: GroupRenderSegment[];
    } = splitAssistantGroupFinalAnswer(segments);
    expect(blocksIn(finalSegments).map((item) => item.id)).toEqual(['final']);
    expect(
      shouldFoldProcess({
        enabled: true,
        hasFinalAnswer: true,
        isGenerating: false,
        isLatestItem: true,
        operationEnded: true,
        processSegments: processSegments.filter((segment) => !segment.preserveOutsideProcessFold),
      }),
    ).toBe(true);
  });

  it('leaves source reasoning before an interactive-first batch in the foldable process', () => {
    const { segments } = view([
      {
        ...block('mixed', [tool('app', true), tool('search')], 'Building it.'),
        reasoning: { content: 'Plan the output.' },
      },
    ]);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ kind: 'workflow', standalone: true });
    expect(blocksIn([segments[0]!])[0]).toMatchObject({
      content: 'Building it.',
      reasoning: { content: 'Plan the output.' },
      tools: [],
    });
    expect(segments[1]?.preserveOutsideProcessFold).toBe(true);
    expect(callsIn([segments[2]!])).toEqual(['search']);
    expect(blocksIn([segments[2]!])[0]?.reasoning).toBeUndefined();
  });

  it('preserves a delivered app when its assistant step later reports an error', () => {
    const { segments } = view([
      {
        ...block('failed-step', [tool('app', true), tool('search')]),
        error: { message: 'The next step failed', type: 'InternalServerError' },
      } as AssistantContentBlock,
    ]);

    expect(callsIn(segments)).toEqual(['app', 'search']);
    expect(segments.filter((segment) => segment.preserveOutsideProcessFold)).toHaveLength(1);
    expect(blocksIn(segments).filter((item) => item.error)).toHaveLength(1);
  });

  it('does not classify an unrelated API or tool as a persistent deliverable', () => {
    const { segments } = view([
      block('step', [
        { ...tool('other-api', true), apiName: 'inspect' },
        { ...tool('other-tool'), apiName: 'renderUI' },
      ]),
    ]);

    expect(segments.some((segment) => segment.preserveOutsideProcessFold)).toBe(false);
    expect(callsIn(segments)).toEqual(['other-api', 'other-tool']);
  });

  it('keeps image breakout and image folding rules unchanged beside an app', () => {
    const { segments } = view([
      block('step', [
        tool('search'),
        { ...tool('image'), apiName: 'image_output', identifier: 'codex' },
        tool('app', true),
      ]),
      block('final', [], 'Done.'),
    ]);
    const image = segments.find((segment) => callsIn([segment]).includes('image'));
    expect(image).toMatchObject({ kind: 'workflow', standalone: true });
    expect(image?.preserveOutsideProcessFold).toBeUndefined();
    expect(
      shouldFoldProcess({
        enabled: true,
        hasFinalAnswer: true,
        isGenerating: false,
        operationEnded: true,
        processSegments: segments.filter((segment) => !segment.preserveOutsideProcessFold),
      }),
    ).toBe(false);
  });
});
