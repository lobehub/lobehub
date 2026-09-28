import { describe, expect, it } from 'vitest';

import { agentIdentityPrompt } from './index';

describe('agentIdentityPrompt', () => {
  it('renders name and title with the name as the primary label', () => {
    const result = agentIdentityPrompt({ name: '芙莉莲', title: '魔法使' });

    expect(result).toContain('<name>芙莉莲</name>');
    expect(result).toContain('<title>魔法使</title>');
    expect(result).toContain('The user knows you as "芙莉莲"');
  });

  it('falls back to the title as label when there is no name', () => {
    const result = agentIdentityPrompt({ title: 'Health Assistant' });

    expect(result).not.toContain('<name>');
    expect(result).toContain('<title>Health Assistant</title>');
    expect(result).toContain('The user knows you as "Health Assistant"');
  });

  it('treats blank values as absent', () => {
    expect(agentIdentityPrompt({ name: '  ', title: '' })).toBe('');
    expect(agentIdentityPrompt({})).toBe('');
  });

  it('escapes XML-sensitive characters', () => {
    const result = agentIdentityPrompt({ name: 'A <&> B' });

    expect(result).toContain('<name>A &lt;&amp;&gt; B</name>');
    expect(result).not.toContain('<name>A <&> B</name>');
  });
});
