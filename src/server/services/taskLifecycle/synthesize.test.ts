// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isTrivialAssistantContent,
  selectBriefPriority,
  selectBriefType,
  shouldEmitTopicBrief,
} from './synthesize';

const baseInput = (overrides: Partial<Parameters<typeof shouldEmitTopicBrief>[0]> = {}) => ({
  hasReviewConfigEnabled: false,
  isTrivialContent: false,
  reason: 'done' as string,
  reviewTerminated: false,
  task: { automationMode: null } as { automationMode: 'heartbeat' | 'schedule' | null },
  ...overrides,
});

describe('shouldEmitTopicBrief', () => {
  it('skips when reason=error (error branch handles its own brief)', () => {
    const result = shouldEmitTopicBrief(baseInput({ reason: 'error' }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('error-branch-handled');
  });

  it('skips when judge already terminated the lifecycle', () => {
    const result = shouldEmitTopicBrief(baseInput({ reviewTerminated: true }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('judge-handled');
  });

  it('skips when review is configured (judge owns the brief on this path)', () => {
    const result = shouldEmitTopicBrief(baseInput({ hasReviewConfigEnabled: true }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('review-config-enabled');
  });

  it('skips heartbeat automation ticks (mid-loop, not a delivery)', () => {
    const result = shouldEmitTopicBrief(baseInput({ task: { automationMode: 'heartbeat' } }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('automation-tick');
  });

  it('skips schedule automation ticks', () => {
    const result = shouldEmitTopicBrief(baseInput({ task: { automationMode: 'schedule' } }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('automation-tick');
  });

  it('skips trivial content (empty / whitespace-only acks)', () => {
    const result = shouldEmitTopicBrief(baseInput({ isTrivialContent: true }));
    expect(result.emit).toBe(false);
    expect(result.reason).toBe('trivial-content');
  });

  it('emits for a normal manual-mode topic with substantive content', () => {
    const result = shouldEmitTopicBrief(baseInput());
    expect(result.emit).toBe(true);
  });

  it('skips automation even when other conditions look fine', () => {
    const result = shouldEmitTopicBrief(
      baseInput({
        hasReviewConfigEnabled: false,
        isTrivialContent: false,
        task: { automationMode: 'heartbeat' },
      }),
    );
    expect(result.emit).toBe(false);
  });
});

describe('isTrivialAssistantContent', () => {
  it('treats undefined as trivial', () => {
    expect(isTrivialAssistantContent(undefined)).toBe(true);
  });

  it('treats whitespace-only as trivial', () => {
    expect(isTrivialAssistantContent('   \n\t  ')).toBe(true);
  });

  it('treats short content as trivial', () => {
    expect(isTrivialAssistantContent('OK done.')).toBe(true);
  });

  it('treats substantive content as non-trivial', () => {
    expect(
      isTrivialAssistantContent('I have completed the analysis and produced a 3-page report.'),
    ).toBe(false);
  });
});

describe('selectBriefType / selectBriefPriority', () => {
  it('first cut emits result/normal for every non-skipped topic', () => {
    expect(selectBriefType(baseInput())).toBe('result');
    expect(selectBriefPriority(baseInput())).toBe('normal');
  });
});
