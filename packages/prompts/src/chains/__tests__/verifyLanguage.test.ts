import { describe, expect, it } from 'vitest';

import { chainVerifyPlan, chainVerifyReport } from '../verify';

const taskGoal = 'Verify only this Task: 挤水分 A/C。\n\nRequired Task outcome: 删除死代码';
const system = (chain: { messages: { content: unknown }[] }) => chain.messages[0].content as string;

const report = (language?: string) =>
  chainVerifyReport({
    deliverable: 'done',
    goal: taskGoal,
    items: [],
    language,
    stats: { failed: 0, passed: 0, total: 0, uncertain: 0 },
    verdict: 'passed',
  });

describe('verify output language', () => {
  it('pins plan criteria to the account language when one is given', () => {
    const prompt = system(chainVerifyPlan({ goal: taskGoal, language: 'zh-CN', maxCriteria: 4 }));

    expect(prompt).toContain(
      'Write title, description, instruction and every requiredEvidence hint in zh-CN, whatever language the run goal is written in.',
    );
  });

  it("falls back to the goal's own content, ignoring its English scaffolding", () => {
    const prompt = system(chainVerifyPlan({ goal: taskGoal, maxCriteria: 4 }));

    expect(prompt).toContain("in the language the user wrote the run goal's own content in");
    expect(prompt).toContain('Ignore the English system wording');
  });

  it('applies the same rule to the round report', () => {
    expect(system(report('ja-JP'))).toContain('Write both fields in ja-JP');
    expect(system(report())).toContain('Ignore the English system wording');
  });
});
