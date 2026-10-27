import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { computeTextDiff } from '../diff';
import { parseImpactAnalysisResponse } from '../schema';
import { buildAnchor, extractDocumentText } from '../text';
import { BASELINE_CONTRACT, CURRENT_CONTRACT, editorDataFromText } from './fixtures';

interface RecordedRun {
  model: string;
  promptVersion: string;
  response: unknown;
}

/**
 * Replays the recorded real-model answer through the production parser and
 * locator. The live eval lives in `apps/server/scripts/evalDocumentReviewImpact.ts`
 * (it needs a model); this test keeps the recorded run honest in CI and catches
 * a parser/anchoring regression that would quietly discard real findings.
 */
describe('recorded real-model impact run', () => {
  const recorded: RecordedRun = JSON.parse(
    readFileSync(new URL('./recordedRealModelRun.json', import.meta.url), 'utf8'),
  );

  const currentText = extractDocumentText({ editorData: editorDataFromText(CURRENT_CONTRACT) });
  const { dropped, items } = parseImpactAnalysisResponse(recorded.response);
  const hints = [
    { label: '付款触发条件', pattern: /付款|支付/ },
    { label: '质保起算时间', pattern: /质保|保修/ },
    { label: '终止时交付义务', pattern: /终止|解除/ },
  ];

  it('keeps the three required semantic hints', () => {
    for (const hint of hints) {
      const match = items.find(
        (item) => hint.pattern.test(item.title) && item.category === 'semantic',
      );
      expect(match, `${hint.label} missing from ${recorded.model}`).toBeDefined();
      expect(buildAnchor(currentText, match!.sourceQuote)).not.toBeNull();
    }
  });

  it('separates direct text differences from semantic impacts', () => {
    expect(items.some((item) => item.category === 'textual')).toBe(true);
    expect(items.some((item) => item.category === 'semantic')).toBe(true);
    expect(dropped).toBe(0);
    expect(recorded.promptVersion).toBe('v1');
  });

  it('locates every quoted anchor in the current body', () => {
    for (const item of items) {
      expect(buildAnchor(currentText, item.sourceQuote), item.title).not.toBeNull();
      if (item.relatedQuote) {
        expect(buildAnchor(currentText, item.relatedQuote), item.title).not.toBeNull();
      }
    }
  });

  it('still has a real diff to explain', () => {
    const diff = computeTextDiff(
      extractDocumentText({ editorData: editorDataFromText(BASELINE_CONTRACT) }),
      currentText,
    );
    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0].before).toContain('最终验收');
    expect(diff.blocks[0].after).toContain('分阶段验收');
  });
});
