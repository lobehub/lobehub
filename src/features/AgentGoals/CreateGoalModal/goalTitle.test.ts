import { describe, expect, it } from 'vitest';

import {
  deriveGoalTitle,
  resolveDraftedTitle,
  resolveFallbackTitle,
  resolveSubmittedGoalTitle,
} from './goalTitle';

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

describe('resolveFallbackTitle', () => {
  const stopgap = '桌宠 TTS';

  it('records the derived title when the field was blank', () => {
    expect(resolveFallbackTitle({ name: stopgap, typed: '' })).toBe(stopgap);
  });

  it('keeps an untouched stopgap across a failed retry', () => {
    expect(resolveFallbackTitle({ name: stopgap, previousFallback: stopgap, typed: stopgap })).toBe(
      stopgap,
    );
  });

  it('does not treat a title edited before a failed retry as a stopgap', () => {
    expect(
      resolveFallbackTitle({ name: '我的标题', previousFallback: stopgap, typed: '我的标题' }),
    ).toBeUndefined();
  });

  it('does not treat a title typed before the first draft as a stopgap', () => {
    expect(resolveFallbackTitle({ name: '我的标题', typed: '我的标题' })).toBeUndefined();
  });
});

describe('resolveDraftedTitle', () => {
  const generated = 'Generated';

  it('uses the generated title on a first draft', () => {
    expect(resolveDraftedTitle({ generated, retrying: false, typed: 'Typed' })).toBe(generated);
  });

  it('keeps a title edited before drafting again', () => {
    expect(
      resolveDraftedTitle({
        generated,
        previousFallback: 'Stopgap',
        retrying: true,
        typed: 'Mine',
      }),
    ).toBe('Mine');
  });

  it('replaces an untouched stopgap or a blank field when drafting again', () => {
    expect(
      resolveDraftedTitle({
        generated,
        previousFallback: 'Stopgap',
        retrying: true,
        typed: 'Stopgap',
      }),
    ).toBe(generated);
    expect(resolveDraftedTitle({ generated, retrying: true, typed: '' })).toBe(generated);
  });
});
