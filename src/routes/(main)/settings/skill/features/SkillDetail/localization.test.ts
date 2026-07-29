import { type TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { getLocalizedBuiltinSkillDetail, getNoPermissionsTitle } from './localization';

const createTranslator = (translations: Record<string, string> = {}) =>
  vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      translations[key] ?? options?.defaultValue ?? key,
  ) as unknown as TFunction<'setting'>;

describe('SkillDetail localization helpers', () => {
  it('localizes builtin skill title and description', () => {
    const t = createTranslator({
      'tools.builtins.lobe-agent-browser.description': '浏览器自动化命令行工具',
      'tools.builtins.lobe-agent-browser.title': '助手浏览器',
    });

    const result = getLocalizedBuiltinSkillDetail(
      {
        content: '# Agent Browser',
        description: 'Browser automation CLI for AI agents.',
        identifier: 'lobe-agent-browser',
        name: 'Agent Browser',
        source: 'builtin',
      },
      'lobe-agent-browser',
      t,
    );

    expect(result).toEqual({ description: '浏览器自动化命令行工具', title: '助手浏览器' });
    expect(t).toHaveBeenCalledWith('tools.builtins.lobe-agent-browser.title', {
      defaultValue: 'Agent Browser',
    });
    expect(t).toHaveBeenCalledWith('tools.builtins.lobe-agent-browser.description', {
      defaultValue: 'Browser automation CLI for AI agents.',
    });
  });

  it('falls back to the identifier when the builtin skill is unavailable', () => {
    const t = createTranslator();

    expect(getLocalizedBuiltinSkillDetail(undefined, 'missing-skill', t)).toEqual({
      description: undefined,
      title: 'missing-skill',
    });
    expect(t).not.toHaveBeenCalled();
  });

  it('omits empty builtin skill descriptions', () => {
    const t = createTranslator({ 'tools.builtins.task.title': '任务' });

    expect(
      getLocalizedBuiltinSkillDetail(
        {
          content: '# Task',
          description: '',
          identifier: 'task',
          name: 'Task',
          source: 'builtin',
        },
        'task',
        t,
      ),
    ).toEqual({ description: undefined, title: '任务' });
    expect(t).toHaveBeenCalledTimes(1);
  });

  it('localizes the no-permissions title for builtin tools only', () => {
    const t = createTranslator({ 'tools.builtins.lobe-calculator.title': '计算器' });

    expect(getNoPermissionsTitle('lobe-calculator', 'builtin', t)).toBe('计算器');
    expect(getNoPermissionsTitle('custom-http', 'mcp-connector', t)).toBe('custom-http');
    expect(t).toHaveBeenCalledTimes(1);
  });
});
