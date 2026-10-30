import { describe, expect, it } from 'vitest';

import { deriveGoalTitle, resolveSubmittedGoalTitle } from './goalTitle';

describe('deriveGoalTitle', () => {
  it('uses the first semantic clause instead of the entire instruction', () => {
    expect(
      deriveGoalTitle(
        '搜集 YC26 的所有公司清单，整理成一个 xlsx。需要包含公司名称、批次、官网与公开来源。',
      ),
    ).toBe('搜集 YC26 的所有公司清单');
  });

  it('caps an unpunctuated title', () => {
    expect(deriveGoalTitle('a'.repeat(80))).toHaveLength(48);
  });
});

describe('resolveSubmittedGoalTitle', () => {
  const instruction =
    '继续并完成桌宠项目 https://github.com/example/desk-pet，在现有基础上完善 TTS 语音系统，补齐唤醒词与打断';

  it('never submits the instruction as the title when the field is blank', () => {
    const { needsGeneratedTitle, title } = resolveSubmittedGoalTitle({ instruction, name: '' });

    expect(title).not.toBe(instruction);
    expect(title).toBe(deriveGoalTitle(instruction));
    expect(needsGeneratedTitle).toBe(true);
  });

  it('names the goal later when the stopgap from a failed draft is left untouched', () => {
    const fallbackTitle = deriveGoalTitle(instruction);

    expect(resolveSubmittedGoalTitle({ fallbackTitle, instruction, name: fallbackTitle })).toEqual({
      needsGeneratedTitle: true,
      title: fallbackTitle,
    });
  });

  it('keeps a title the user wrote', () => {
    expect(
      resolveSubmittedGoalTitle({
        fallbackTitle: deriveGoalTitle(instruction),
        instruction,
        name: '  桌宠 TTS  ',
      }),
    ).toEqual({ needsGeneratedTitle: false, title: '桌宠 TTS' });
  });
});
