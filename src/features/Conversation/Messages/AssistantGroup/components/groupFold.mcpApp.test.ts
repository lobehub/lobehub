import { describe, expect, it } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import { buildChainView } from './groupChain';
import { getChainSegmentKey } from './renderChainSegment';
import type { GroupRenderSegment } from './segments';
import { splitProcessForFold } from './segments';

const tool = (id: string, apiName: string, state?: Record<string, unknown>) =>
  ({
    apiName,
    id,
    identifier: 'weather-demo',
    result: { content: 'ok', id: `${id}-r`, state },
  }) as any;

const blocks = [
  { content: '', id: 'step-1', tools: [tool('t1', 'search_city')] },
  { content: '', id: 'step-2', tools: [tool('t2', 'get_air_quality')] },
  {
    content: '',
    id: 'step-3',
    tools: [
      tool('t3', 'get_weather', { content: [], mcpApp: { resourceUri: 'ui://weather/view' } }),
    ],
  },
  { content: 'Paris looks good for a day out.', id: 'step-4' },
] as AssistantContentBlock[];

const view = (chainBlocks: AssistantContentBlock[], enableMcpApps: boolean) =>
  buildChainView(
    { blocks: chainBlocks, id: 'assistant-1' },
    { enableMcpApps, hasActiveOperation: false, isGenerating: false },
  );

const blockIds = (segments: GroupRenderSegment[]) =>
  segments.flatMap((segment) =>
    segment.kind === 'workflow' ? segment.blocks.map((block) => block.id) : [segment.block.id],
  );

// The group's layout once a turn's process may fold (Group.tsx renders these slices)
describe('folding a turn with an MCP App view', () => {
  it('keeps the view out of the fold, between the folded steps and the answer', () => {
    const chain = view(blocks, true);
    const { finalSegments, liftedSegments, processSegments } = splitProcessForFold(chain.segments, {
      enableMcpApps: true,
    });

    expect(blockIds(processSegments)).toEqual(['step-1', 'step-2']);
    expect(blockIds(liftedSegments)).toEqual(['step-3']);
    expect(blockIds(finalSegments)).toEqual(['step-4']);
  });

  it('keys the view by its place in the whole turn, so folding does not remount it', () => {
    const chain = view(blocks, true);
    const viewSegment = splitProcessForFold(chain.segments, { enableMcpApps: true })
      .liftedSegments[0]!;

    // The same key the unfolded turn renders the segment under
    expect(getChainSegmentKey(chain, viewSegment)).toBe(
      getChainSegmentKey(
        chain,
        chain.segments.find((s) => blockIds([s]).includes('step-3'))!,
      ),
    );
  });

  it('keeps every key when the mcp_apps flag arrives after the first paint', () => {
    const plain = [
      { content: '', id: 'step-1', tools: [tool('t1', 'search_city')] },
      { content: 'Paris looks good for a day out.', id: 'step-2' },
    ] as AssistantContentBlock[];
    const keys = (enableMcpApps: boolean) => {
      const chain = view(plain, enableMcpApps);
      return chain.segments.map((segment) => getChainSegmentKey(chain, segment));
    };

    expect(keys(true)).toEqual(keys(false));
  });

  it('folds the view with the rest of the process while the mcp_apps flag is off', () => {
    const chain = view(blocks, false);
    const { finalSegments, liftedSegments, processSegments } = splitProcessForFold(chain.segments, {
      enableMcpApps: false,
    });

    expect(liftedSegments).toEqual([]);
    expect(blockIds(processSegments)).toContain('step-3');
    expect(blockIds(finalSegments)).toEqual(['step-4']);
  });
});
