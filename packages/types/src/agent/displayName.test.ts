import { describe, expect, it } from 'vitest';

import {
  agentDisplayName,
  agentIdentityLabel,
  agentRenameField,
  agentSecondaryDisplayName,
} from './displayName';

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

describe('agentRenameField', () => {
  it('renames the personal name when the agent has one — that is what the label shows', () => {
    expect(agentRenameField({ name: 'Alice', title: 'Health Assistant' })).toBe('name');
  });

  it('renames the title when there is no name to show', () => {
    expect(agentRenameField({ name: null, title: 'Health Assistant' })).toBe('title');
    expect(agentRenameField({ title: 'Health Assistant' })).toBe('title');
  });

  it('treats a blank name as absent, like the label does', () => {
    expect(agentRenameField({ name: '   ', title: 'Health Assistant' })).toBe('title');
  });
});

describe('agentIdentityLabel', () => {
  it('introduces a named agent by its name, with its role behind it', () => {
    expect(agentIdentityLabel({ name: 'Nasa', title: 'Shadow Arvin' })).toBe('Nasa (Shadow Arvin)');
  });

  it('uses the title alone when there is no name', () => {
    expect(agentIdentityLabel({ name: null, title: 'Shadow Arvin' })).toBe('Shadow Arvin');
    expect(agentIdentityLabel({ name: '  ', title: 'Shadow Arvin' })).toBe('Shadow Arvin');
  });

  it('does not repeat a role the name already spells out', () => {
    expect(agentIdentityLabel({ name: 'Max 的 Kimi Code', title: 'Kimi Code' })).toBe(
      'Max 的 Kimi Code',
    );
    expect(agentIdentityLabel({ name: 'Nasa', title: 'Nasa' })).toBe('Nasa');
  });

  it('falls back when the agent has neither', () => {
    expect(agentIdentityLabel({}, 'Current Agent')).toBe('Current Agent');
    expect(agentIdentityLabel(null)).toBeUndefined();
  });
});
