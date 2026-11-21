import { describe, expect, it } from 'vitest';

import { chainTaskTopicHandoff, TASK_TOPIC_HANDOFF_PROMPT_VERSION } from './taskTopicHandoff';

describe('chainTaskTopicHandoff', () => {
  /**
   * Regression: the handoff title becomes the Goal finding's title, and titles
   * that only said "完成 Neon 能力调研" told the reader nothing about the finding.
   */
  it('titles the result itself rather than the fact that work happened', () => {
    const payload = chainTaskTopicHandoff({
      lastAssistantContent: '结论：Neon 能覆盖从开通到管理的完整链路。',
      responseLanguage: 'zh-CN',
      taskInstruction: 'Research Neon capabilities',
      taskName: 'R1 · Neon 能给 agent 提供什么？',
    });
    const system = payload.messages![0].content as string;

    expect(TASK_TOPIC_HANDOFF_PROMPT_VERSION).toBe('v1.2');
    expect(system).toContain('what was found, decided or delivered');
    expect(system).toContain('never a status such as "Completed X", "Task done" or "完成 X"');
    expect(system).toContain('condense that line into the title');
  });

  /**
   * Regression: a Claude Code run delivered its full verification report, then a
   * finished background job woke it for one more line ("results are unchanged").
   * The handoff saw only that line and told the Goal coordinator nothing was
   * delivered, which re-dispatched the whole verification as a new Task.
   */
  it('hands the earlier report to the model when the last reply may be a trailing remark', () => {
    const payload = chainTaskTopicHandoff({
      earlierReport: '# Verification passed\n\nAll five checks passed.',
      lastAssistantContent: 'The background file search has finished; the results are unchanged.',
      taskInstruction: 'Verify the hover fix',
      taskName: 'T-1',
    });
    const system = payload.messages![0].content as string;
    const user = payload.messages![1].content as string;

    expect(system).toContain('base title, summary and keyFindings on the earlier report');
    expect(system).toContain('A trailing remark never means the run delivered nothing');
    expect(user).toContain('Earlier report from this run:\n# Verification passed');
    expect(user.indexOf('Earlier report')).toBeLessThan(user.indexOf('Last assistant response'));
  });

  it('omits the earlier-report block when the run has none', () => {
    const payload = chainTaskTopicHandoff({
      lastAssistantContent: 'done',
      taskInstruction: 'x',
      taskName: 'y',
    });

    expect(payload.messages![1].content).not.toContain('Earlier report');
    expect(payload.messages![0].content).toContain('Set "finalIsTrailingRemark" to false');
  });
});
