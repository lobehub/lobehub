import { describe, expect, it } from 'vitest';

import { toNotificationPreview } from './toNotificationPreview';

describe('toNotificationPreview', () => {
  it('returns empty string for empty input', () => {
    expect(toNotificationPreview('')).toBe('');
    expect(toNotificationPreview(null)).toBe('');
    expect(toNotificationPreview(undefined)).toBe('');
  });

  it('strips headings, bold and link syntax', () => {
    expect(
      toNotificationPreview(
        '## ✅ 每日 LOBE 注释清理完成\n\n**PR**: [#17689](https://github.com/lobehub/lobehub/pull/17689)',
      ),
    ).toBe('✅ 每日 LOBE 注释清理完成 PR: #17689');
  });

  it('flattens markdown tables and drops divider rows', () => {
    const content = [
      '### 清理概要',
      '',
      '| 指标 | 数值 |',
      '|------|------|',
      '| 修改文件数 | **118** |',
    ].join('\n');

    const preview = toNotificationPreview(content);

    expect(preview).toBe('清理概要 指标 数值 修改文件数 118');
    expect(preview).not.toContain('|');
    expect(preview).not.toContain('--');
  });

  it('strips heading markers that were already collapsed mid-line upstream', () => {
    expect(
      toNotificationPreview(
        '好的！我来分析。 ## 一、项目整体工作量分析 ### 系统模块拆解 按照架构来看',
      ),
    ).toBe('好的！我来分析。 一、项目整体工作量分析 系统模块拆解 按照架构来看');
  });

  it('keeps hashtags intact when stripping mid-line heading markers', () => {
    expect(toNotificationPreview('deployed to #prod channel')).toBe('deployed to #prod channel');
  });

  it('collapses multi-line content into a single line', () => {
    expect(toNotificationPreview('Line 1\n\n\nLine 2\n> quoted\n\n---\n\n- item')).toBe(
      'Line 1 Line 2 quoted item',
    );
  });

  it('truncates over-long previews with an ellipsis', () => {
    const preview = toNotificationPreview('a'.repeat(500));

    expect(preview).toHaveLength(301);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('keeps short plain text untouched', () => {
    expect(toNotificationPreview('图片生成完成')).toBe('图片生成完成');
  });
});
