// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mergeWindowOutcomes, splitDocumentWindows } from '../playbook';

const MAX = 100;

const clamp = (text: string) => text.replaceAll(/\s/g, '');

describe('splitDocumentWindows', () => {
  it('keeps a document that fits the budget in one window', () => {
    expect(splitDocumentWindows('第 1 条 短合同。', MAX)).toEqual(['第 1 条 短合同。']);
  });

  it('never drops text when the document exceeds the budget', () => {
    const text = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条 ${'条款'.repeat(5)}`).join(
      '\n\n',
    );
    expect(text.length).toBeGreaterThan(MAX);

    const windows = splitDocumentWindows(text, MAX);

    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) expect(window.length).toBeLessThanOrEqual(MAX);
    expect(clamp(windows.join(''))).toBe(clamp(text));
  });

  it('hard-splits a single paragraph longer than the budget', () => {
    const paragraph = '违'.repeat(250);

    const windows = splitDocumentWindows(paragraph, MAX);

    expect(windows).toHaveLength(3);
    expect(clamp(windows.join(''))).toBe(paragraph);
  });

  it('keeps a tail-only clause reachable instead of truncating it away', () => {
    const head = Array.from({ length: 40 }, () => '通用条款。').join('\n\n');
    const tail = '尾部例外：甲方可无理由单方解除。';
    const text = `${head}\n\n${tail}`;

    const windows = splitDocumentWindows(text, MAX);

    expect(windows.some((window) => window.includes(tail))).toBe(true);
  });
});

describe('mergeWindowOutcomes', () => {
  const outcome = (
    status: 'passed' | 'failed' | 'uncertain',
    explanation: string = status,
  ) => ({
    evidence: [],
    explanation,
    status,
  });

  it('lets a violation found in any window win', () => {
    const merged = mergeWindowOutcomes([
      outcome('passed', '前段合规'),
      outcome('failed', '后段违反'),
      outcome('uncertain'),
    ]);

    expect(merged).toMatchObject({ explanation: '后段违反', status: 'failed' });
  });

  it('passes only when a window actually evidenced the rule', () => {
    const merged = mergeWindowOutcomes([outcome('uncertain'), outcome('passed', '第 5 条')]);

    expect(merged).toMatchObject({ explanation: '第 5 条', status: 'passed' });
  });

  it('never turns an all-uncertain reading into a pass', () => {
    const merged = mergeWindowOutcomes([outcome('uncertain', '证据不足'), outcome('uncertain')]);

    expect(merged).toMatchObject({ explanation: '证据不足', status: 'uncertain' });
  });

  it('keeps an unfinished window from inheriting a sibling pass', () => {
    const merged = mergeWindowOutcomes([
      outcome('passed', '前段合规'),
      {
        evidence: [],
        explanation: '模型调用失败，未能完成判定。（第 2/2 段）',
        incomplete: true,
        status: 'uncertain',
      },
    ]);

    expect(merged).toMatchObject({ status: 'uncertain' });
    expect(merged.explanation).toContain('第 2/2 段');
  });

  it('still lets a violation in another window win over an unfinished one', () => {
    const merged = mergeWindowOutcomes([
      { evidence: [], explanation: '模型输出无法解析', incomplete: true, status: 'uncertain' },
      outcome('failed', '后段违反'),
    ]);

    expect(merged).toMatchObject({ explanation: '后段违反', status: 'failed' });
  });

  it('stays uncertain when every window failed to produce a verdict', () => {
    const merged = mergeWindowOutcomes([
      { evidence: [], explanation: '模型调用失败', incomplete: true, status: 'uncertain' },
      { evidence: [], explanation: '模型未返回该规则的结论', incomplete: true, status: 'uncertain' },
    ]);

    expect(merged).toMatchObject({ explanation: '模型调用失败', status: 'uncertain' });
  });
});
