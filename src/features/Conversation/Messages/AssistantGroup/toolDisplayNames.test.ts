import { describe, expect, it } from 'vitest';

import { type AssistantContentBlock } from '@/types/index';

import { POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD } from './constants';
import {
  getPostToolAnswerSplitIndex,
  scorePostToolBlockAsFinalAnswer,
  shapeProseForWorkflowHeadline,
} from './toolDisplayNames';

const blk = (p: Partial<AssistantContentBlock> & { id: string }): AssistantContentBlock =>
  ({ content: '', ...p }) as AssistantContentBlock;

describe('shapeProseForWorkflowHeadline', () => {
  it('does not split on dot inside Node.js in CJK prose', () => {
    const s =
      '我来帮您搜索 Node.js 24 的发布说明并撰写一份全面的技术总结。首先，我需要激活必要的工具来进行搜索和文件操作。';
    const out = shapeProseForWorkflowHeadline(s);
    expect(out).toContain('Node.js 24');
    expect(out).toContain('技术总结');
    expect(out).not.toMatch(/^我来帮您搜索 Node\.?\s*$/i);
  });

  it('uses Latin sentence dot when no CJK', () => {
    const s = 'Search Node.js 24 release notes. Then crawl docs.';
    const out = shapeProseForWorkflowHeadline(s);
    expect(out).toContain('Node.js 24');
    expect(out).toContain('release notes');
    expect(out).not.toContain('Then crawl');
  });
});

describe('post-tool final answer split', () => {
  it('returns split index for long structured prose-only block after last tool', () => {
    const long =
      'Direct summary - Node.js 24 (released May 6, 2025) is a major platform update that upgrades V8 to a newer track, ships notable HTTP and fetch-related changes, and introduces practical migration items for native addons and tooling.\n\n## Checklist\n\n- Rebuild native modules';
    const blocks = [
      blk({ id: '0', content: 'intro', tools: [{ apiName: 'search', id: 't1' } as any] }),
      blk({ id: '1', content: long }),
    ];
    const ix = getPostToolAnswerSplitIndex(blocks, 0, true, true);
    expect(ix).toBe(1);
  });

  it('does not split short step line after tools', () => {
    const blocks = [
      blk({ id: '0', content: 'x', tools: [{ apiName: 'search', id: 't1' } as any] }),
      blk({ id: '1', content: '现在我来搜索资料。' }),
    ];
    expect(scorePostToolBlockAsFinalAnswer(blocks[1]!)).toBeLessThan(
      POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD,
    );
    expect(getPostToolAnswerSplitIndex(blocks, 0, true, true)).toBeNull();
  });
});
