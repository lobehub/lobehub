import { describe, expect, it } from 'vitest';

import { getAgentRuntimeConfig } from '../../index';
import { createSystemRole } from './systemRole';

describe('inbox createSystemRole', () => {
  it('defaults to Lobe when the assistant has no custom name', () => {
    expect(createSystemRole()).toContain('You are Lobe, an AI Agent');
    expect(createSystemRole()).not.toMatch(/language/i);
  });

  it('introduces the user-given name instead of the product default', () => {
    const result = createSystemRole({ name: '芙莉莲' });

    expect(result).toContain('You are 芙莉莲, an AI Agent');
    expect(result).not.toContain('You are Lobe');
  });

  it('carries the role title alongside the name', () => {
    expect(createSystemRole({ name: '芙莉莲', title: '魔法使' })).toContain(
      'You are 芙莉莲 (魔法使), an AI Agent',
    );
  });

  it('uses the title as identity when there is no name', () => {
    expect(createSystemRole({ title: 'Health Assistant' })).toContain(
      'You are Lobe (Health Assistant), an AI Agent',
    );
  });

  it('treats blank identity values as absent', () => {
    expect(createSystemRole({ name: '  ', title: '' })).toContain('You are Lobe, an AI Agent');
  });

  it('uses the explicitly selected reply language', () => {
    const result = getAgentRuntimeConfig('inbox', { userLocale: 'zh-CN' })?.systemRole;
    expect(result).toContain('Preferred reply language: zh-CN');
    expect(result).toContain('Use this language unless the user explicitly asks to switch.');
  });
});
