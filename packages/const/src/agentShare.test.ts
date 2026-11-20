import { describe, expect, it } from 'vitest';

import {
  hasShareToolGrant,
  isAgentShareModelRestrictionExempt,
  isAgentShareVisitorHeteroType,
  isShareToolApiGranted,
  resolveShareAllowedSkillIds,
  resolveShareToolGrants,
} from './agentShare';

describe('resolveShareToolGrants', () => {
  it('grants every API for a grant without `apis`', () => {
    const grants = resolveShareToolGrants([{ identifier: 'lobe-agent' }]);
    expect(grants.get('lobe-agent')).toBe('all');
  });

  it('collects the granted `apis` into a Set', () => {
    const grants = resolveShareToolGrants([
      { apis: ['analyzeMedia', 'updatePlan'], identifier: 'lobe-agent' },
    ]);
    expect(grants.get('lobe-agent')).toEqual(new Set(['analyzeMedia', 'updatePlan']));
  });

  it('lets a toolset-level grant win over a per-API one for the same identifier, regardless of order', () => {
    const before = resolveShareToolGrants([
      { identifier: 'lobe-agent' },
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
    ]);
    expect(before.get('lobe-agent')).toBe('all');

    const after = resolveShareToolGrants([
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
      { identifier: 'lobe-agent' },
    ]);
    expect(after.get('lobe-agent')).toBe('all');
  });

  it('unions two per-API grants for the same identifier', () => {
    const grants = resolveShareToolGrants([
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
      { apis: ['updatePlan'], identifier: 'lobe-agent' },
    ]);
    expect(grants.get('lobe-agent')).toEqual(new Set(['analyzeMedia', 'updatePlan']));
  });

  it('reads an explicit empty `apis` array fail-closed as no grant, never as a toolset-level grant', () => {
    const grants = resolveShareToolGrants([{ apis: [], identifier: 'calculator' }]);

    expect(grants.has('calculator')).toBe(false);
  });

  it('ignores an entry with an empty identifier', () => {
    const grants = resolveShareToolGrants([{ identifier: '' }, { identifier: 'calculator' }]);
    expect(grants.has('')).toBe(false);
    expect(grants.get('calculator')).toBe('all');
  });

  it('tolerates an unset grants array', () => {
    expect(resolveShareToolGrants(undefined).size).toBe(0);
  });
});

describe('hasShareToolGrant / isShareToolApiGranted', () => {
  it('reports presence of any grant for an identifier', () => {
    const grants = resolveShareToolGrants([{ apis: ['analyzeMedia'], identifier: 'lobe-agent' }]);
    expect(hasShareToolGrant(grants, 'lobe-agent')).toBe(true);
    expect(hasShareToolGrant(grants, 'calculator')).toBe(false);
  });

  it('checks per-API grants precisely', () => {
    const grants = resolveShareToolGrants([{ apis: ['analyzeMedia'], identifier: 'lobe-agent' }]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(true);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'callSubAgent')).toBe(false);
  });

  it('a toolset-level grant covers every API', () => {
    const grants = resolveShareToolGrants([{ identifier: 'lobe-agent' }]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'anything')).toBe(true);
  });

  it('an ungranted identifier grants nothing', () => {
    const grants = resolveShareToolGrants([]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(false);
  });
});

describe('resolveShareAllowedSkillIds', () => {
  it('keeps only the candidates the creator named, in candidate order', () => {
    expect(
      resolveShareAllowedSkillIds(['brand-voice', 'pdf-report', 'internal-audit'], {
        skillGrants: ['pdf-report', 'brand-voice'],
      }),
    ).toEqual(['brand-voice', 'pdf-report']);
  });

  it('ignores a granted id the run has no candidate for', () => {
    // A skill the creator deleted after granting it, for instance: the grant
    // survives in the stored config but must not conjure a skill into the pool.
    expect(resolveShareAllowedSkillIds(['pdf-report'], { skillGrants: ['deleted-skill'] })).toEqual(
      [],
    );
  });

  it('grants nothing when skillGrants is empty', () => {
    expect(resolveShareAllowedSkillIds(['pdf-report'], { skillGrants: [] })).toEqual([]);
  });

  it('grants nothing when skillGrants was never configured', () => {
    // Default-closed: no grant means no skill, and `toolGrants` is never read
    // as a skill list even though the two share one identifier namespace.
    expect(resolveShareAllowedSkillIds(['pdf-report'], {})).toEqual([]);
  });
});

describe('isAgentShareVisitorHeteroType', () => {
  it.each(['claude-code', 'codex', 'opencode', 'cursor', 'kimi-code', 'deepseek-harness'])(
    'lets a visitor run the locally executed runtime %s',
    (type) => {
      expect(isAgentShareVisitorHeteroType(type)).toBe(true);
    },
  );

  it.each(['openclaw', 'hermes', 'unknown-cli', '', null, undefined])(
    'refuses %s, which has no visitor-scoped device dispatch',
    (type) => {
      expect(isAgentShareVisitorHeteroType(type)).toBe(false);
    },
  );
});

describe('isAgentShareModelRestrictionExempt', () => {
  const driver = (type: string) => ({ heterogeneousProvider: { type } });

  it('exempts Claude Code and Codex agents, which run no provider model', () => {
    expect(
      isAgentShareModelRestrictionExempt({
        agencyConfig: driver('claude-code'),
        provider: 'claude-code',
      }),
    ).toBe(true);
    expect(
      isAgentShareModelRestrictionExempt({ agencyConfig: driver('codex'), provider: 'codex' }),
    ).toBe(true);
  });

  it.each(['opencode', 'kimi-code', 'deepseek-harness'])(
    'exempts the other locally executed runtime %s',
    (type) => {
      expect(
        isAgentShareModelRestrictionExempt({ agencyConfig: driver(type), provider: type }),
      ).toBe(true);
    },
  );

  it('keeps LobeHub agents and runtimes a visitor cannot run restricted', () => {
    expect(isAgentShareModelRestrictionExempt(undefined)).toBe(false);
    expect(isAgentShareModelRestrictionExempt({ agencyConfig: null, provider: 'lobehub' })).toBe(
      false,
    );
    expect(
      isAgentShareModelRestrictionExempt({
        agencyConfig: { heterogeneousProvider: null },
        provider: 'claude-code',
      }),
    ).toBe(false);
    expect(
      isAgentShareModelRestrictionExempt({
        agencyConfig: driver('openclaw'),
        provider: 'openclaw',
      }),
    ).toBe(false);
  });

  it('checks a real provider saved next to a Claude Code driver', () => {
    expect(
      isAgentShareModelRestrictionExempt({
        agencyConfig: driver('claude-code'),
        provider: 'openai',
      }),
    ).toBe(false);
  });
});
