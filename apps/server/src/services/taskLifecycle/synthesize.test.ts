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
  it("returns 'yes' when reason=error (user must be told the run failed)", () => {
    const result = shouldEmitTopicBrief(baseInput({ reason: 'error' }));
    expect(result.emit).toBe('yes');
    expect(result.reason).toBe('execution-error');
  });

  it("returns 'no' when judge already terminated the lifecycle", () => {
    const result = shouldEmitTopicBrief(baseInput({ reviewTerminated: true }));
    expect(result.emit).toBe('no');
    expect(result.reason).toBe('judge-handled');
  });

  it("returns 'no' when review is configured (judge owns the brief on this path)", () => {
    const result = shouldEmitTopicBrief(baseInput({ hasReviewConfigEnabled: true }));
    expect(result.emit).toBe('no');
    expect(result.reason).toBe('review-config-enabled');
  });

  it("returns 'unknown' for heartbeat ticks (defers to LLM — most are noise but some warrant surfacing)", () => {
    const result = shouldEmitTopicBrief(baseInput({ task: { automationMode: 'heartbeat' } }));
    expect(result.emit).toBe('unknown');
    expect(result.reason).toBe('heartbeat-needs-judge');
  });

  it("returns 'yes' on every schedule tick (contractual daily brief)", () => {
    const result = shouldEmitTopicBrief(baseInput({ task: { automationMode: 'schedule' } }));
    expect(result.emit).toBe('yes');
    expect(result.reason).toBe('scheduled-tick');
  });

  it("still returns 'yes' for a schedule tick even when content looks trivial", () => {
    const result = shouldEmitTopicBrief(
      baseInput({ isTrivialContent: true, task: { automationMode: 'schedule' } }),
    );
    expect(result.emit).toBe('yes');
  });

  it("returns 'no' for trivial content on a non-scheduled task", () => {
    const result = shouldEmitTopicBrief(baseInput({ isTrivialContent: true }));
    expect(result.emit).toBe('no');
    expect(result.reason).toBe('trivial-content');
  });

  it("returns 'unknown' for a normal manual-mode topic with substantive content (defers to LLM judge)", () => {
    const result = shouldEmitTopicBrief(baseInput());
    expect(result.emit).toBe('unknown');
    expect(result.reason).toBe('needs-llm-judge');
  });

  it("returns 'unknown' for heartbeat even when other conditions look fine", () => {
    const result = shouldEmitTopicBrief(
      baseInput({
        hasReviewConfigEnabled: false,
        isTrivialContent: false,
        task: { automationMode: 'heartbeat' },
      }),
    );
    expect(result.emit).toBe('unknown');
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
