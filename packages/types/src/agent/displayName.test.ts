import { describe, expect, it } from 'vitest';

import { agentDisplayName, agentSecondaryDisplayName } from './displayName';

describe('agentDisplayName', () => {
  it('prefers the personal name over the role', () => {
    expect(agentDisplayName({ name: '小艾', title: '健康助手' })).toBe('小艾');
  });

  it('falls back to the title for an agent with no name', () => {
    expect(agentDisplayName({ name: null, title: 'Health Assistant' })).toBe('Health Assistant');
  });

  it('treats a blank name as absent so it cannot beat a real title', () => {
    expect(agentDisplayName({ name: '   ', title: 'Health Assistant' })).toBe('Health Assistant');
  });

  it('trims the resolved label', () => {
    expect(agentDisplayName({ name: '  Alice  ' })).toBe('Alice');
  });

  it('uses the caller fallback when both fields are empty', () => {
    expect(agentDisplayName({ name: null, title: '  ' }, 'Custom Agent')).toBe('Custom Agent');
    expect(agentDisplayName(null, 'Custom Agent')).toBe('Custom Agent');
  });

  it('returns undefined without a fallback when nothing is set', () => {
    expect(agentDisplayName({})).toBeUndefined();
    expect(agentDisplayName(undefined)).toBeUndefined();
  });
});

describe('agentSecondaryDisplayName', () => {
  it('shows the role of a named agent', () => {
    expect(agentSecondaryDisplayName({ name: 'Alice', title: 'Health Assistant' })).toBe(
      'Health Assistant',
    );
  });

  it('treats a heterogeneous agent like any other — its role, not its runtime', () => {
    expect(agentSecondaryDisplayName({ name: '陆令言', title: 'default' })).toBe('default');
  });

  it('shows nothing when the title is already the primary label', () => {
    expect(agentSecondaryDisplayName({ title: 'Health Assistant' })).toBeUndefined();
    expect(agentSecondaryDisplayName({ name: '  ', title: 'Pi' })).toBeUndefined();
  });

  it('suppresses a role the primary name already spells out as its suffix', () => {
    expect(
      agentSecondaryDisplayName({ name: 'Max 的 Kimi Code', title: 'Kimi Code' }),
    ).toBeUndefined();
    expect(
      agentSecondaryDisplayName({ name: "MaxLiu's Claude Code", title: 'Claude Code' }),
    ).toBeUndefined();
    expect(
      agentSecondaryDisplayName({ name: 'Claude Code', title: 'Claude Code' }),
    ).toBeUndefined();
  });

  it('restores the role tag once the name no longer echoes it', () => {
    expect(agentSecondaryDisplayName({ name: '小K', title: 'Kimi Code' })).toBe('Kimi Code');
  });

  it('keeps the tag when the name merely contains the role as a substring', () => {
    expect(agentSecondaryDisplayName({ name: 'Arthur', title: 'Art' })).toBe('Art');
    expect(agentSecondaryDisplayName({ name: 'MozArt', title: 'Art' })).toBe('Art');
    expect(agentSecondaryDisplayName({ name: 'Claude Code 助手', title: 'Claude Code' })).toBe(
      'Claude Code',
    );
  });

  it('treats a blank role as absent', () => {
    expect(agentSecondaryDisplayName({ name: 'Alice', title: '   ' })).toBeUndefined();
    expect(agentSecondaryDisplayName({ name: 'Alice' })).toBeUndefined();
    expect(agentSecondaryDisplayName(null)).toBeUndefined();
  });
});
