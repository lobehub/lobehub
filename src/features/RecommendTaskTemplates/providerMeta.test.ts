import type { TaskTemplateSkillRequirement } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { findNextUnconnectedSpec, getProviderMeta } from './providerMeta';

describe('getProviderMeta', () => {
  it('resolves lobehub source via LOBEHUB_SKILL_PROVIDERS', () => {
    const meta = getProviderMeta({ provider: 'github', source: 'lobehub' });
    expect(meta).toMatchObject({ label: 'GitHub', provider: 'github', source: 'lobehub' });
    expect(meta?.icon).toBeDefined();
  });

  it('resolves klavis source via KLAVIS_SERVER_TYPES', () => {
    const meta = getProviderMeta({ provider: 'notion', source: 'klavis' });
    expect(meta).toMatchObject({ label: 'Notion', provider: 'notion', source: 'klavis' });
    expect(meta?.icon).toBeDefined();
  });

  it('returns undefined for unknown provider', () => {
    expect(getProviderMeta({ provider: 'nonexistent-x', source: 'lobehub' })).toBeUndefined();
    expect(getProviderMeta({ provider: 'nonexistent-x', source: 'klavis' })).toBeUndefined();
  });

  it('does not cross namespaces (lobehub id under klavis source returns undefined)', () => {
    // 'github' is a lobehub provider id, not a klavis identifier.
    expect(getProviderMeta({ provider: 'github', source: 'klavis' })).toBeUndefined();
  });
});

describe('findNextUnconnectedSpec', () => {
  const allConnected = () => true;
  const noneConnected = () => false;

  it('returns undefined when specs is undefined or empty', () => {
    expect(findNextUnconnectedSpec(undefined, noneConnected)).toBeUndefined();
    expect(findNextUnconnectedSpec([], noneConnected)).toBeUndefined();
  });

  it('returns undefined when all specs are connected', () => {
    const specs: TaskTemplateSkillRequirement[] = [
      { provider: 'github', source: 'lobehub' },
      { provider: 'notion', source: 'klavis' },
    ];
    expect(findNextUnconnectedSpec(specs, allConnected)).toBeUndefined();
  });

  it('returns the first spec when none are connected', () => {
    const specs: TaskTemplateSkillRequirement[] = [
      { provider: 'github', source: 'lobehub' },
      { provider: 'notion', source: 'klavis' },
    ];
    const result = findNextUnconnectedSpec(specs, noneConnected);
    expect(result?.provider).toBe('github');
    expect(result?.label).toBe('GitHub');
  });

  it('skips already-connected specs and returns the next missing one in order', () => {
    const specs: TaskTemplateSkillRequirement[] = [
      { provider: 'github', source: 'lobehub' },
      { provider: 'linear', source: 'lobehub' },
      { provider: 'notion', source: 'klavis' },
    ];
    const isConnected = (s: TaskTemplateSkillRequirement) =>
      s.provider === 'github' || s.provider === 'linear';
    const result = findNextUnconnectedSpec(specs, isConnected);
    expect(result?.provider).toBe('notion');
    expect(result?.source).toBe('klavis');
  });

  it('skips specs with unknown providers (no meta) and continues searching', () => {
    const specs: TaskTemplateSkillRequirement[] = [
      { provider: 'nonexistent-x', source: 'lobehub' },
      { provider: 'notion', source: 'klavis' },
    ];
    const result = findNextUnconnectedSpec(specs, noneConnected);
    expect(result?.provider).toBe('notion');
  });
});
