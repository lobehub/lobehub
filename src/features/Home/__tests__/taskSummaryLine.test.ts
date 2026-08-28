import { describe, expect, it } from 'vitest';

import { resolveTaskSummaryLine } from '../HomeModeContent';

describe('resolveTaskSummaryLine', () => {
  it('reads the instruction, which is what the task was asked to do', () => {
    expect(
      resolveTaskSummaryLine(
        { description: '一句摘要', instruction: '扫描依赖漏洞并汇总高危项' },
        '每日依赖安全周检',
      ),
    ).toBe('扫描依赖漏洞并汇总高危项');
  });

  it('falls back to the description when there is no instruction', () => {
    expect(resolveTaskSummaryLine({ description: '一句摘要', instruction: '  ' }, '任务名')).toBe(
      '一句摘要',
    );
  });

  it('flattens markdown and whitespace into a single line', () => {
    expect(
      resolveTaskSummaryLine({ instruction: '# 标题\n\n- **第一步**\n- 第二步' }, '任务名'),
    ).toBe('标题 第一步 第二步');
  });

  // A task created from the composer takes its name from its instruction, so
  // printing both would say the same sentence twice in two colours.
  it('drops the line when it only repeats the title', () => {
    expect(resolveTaskSummaryLine({ instruction: '写一首诗' }, '写一首诗')).toBeUndefined();
    expect(resolveTaskSummaryLine({ instruction: '  写一首诗  ' }, '写一首诗')).toBeUndefined();
  });

  it('has nothing to show when both sources are empty', () => {
    expect(
      resolveTaskSummaryLine({ description: null, instruction: null }, '任务名'),
    ).toBeUndefined();
  });
});
