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

    expect(TASK_TOPIC_HANDOFF_PROMPT_VERSION).toBe('v1.1');
    expect(system).toContain('what was found, decided or delivered');
    expect(system).toContain('never a status such as "Completed X", "Task done" or "完成 X"');
    expect(system).toContain('condense that line into the title');
  });
});
