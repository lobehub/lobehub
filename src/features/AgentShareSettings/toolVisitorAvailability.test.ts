import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { describe, expect, it } from 'vitest';

import {
  getShareApiAvailability,
  getShareToolAvailability,
  getVisitorVisibleEnabledToolIds,
  runtimeManagedShareCandidateToolIds,
  setShareToolGrant,
  toggleShareToolApi,
  toggleShareToolId,
  toggleShareToolsetGrant,
} from './toolVisitorAvailability';

describe('getShareToolAvailability', () => {
  it('blocks builtins the server gate refuses outright', () => {
    // Both survive the master allowlist only to be blocked by
    // DATA_TOOL_ACCESS_RULES' unconditional `none` grant.
    expect(getShareToolAvailability(KnowledgeBaseIdentifier)).toBe('blocked');
    expect(getShareToolAvailability(AgentDocumentsIdentifier)).toBe('blocked');
  });

  it('blocks builtins outside the master allowlist', () => {
    expect(getShareToolAvailability('lobe-local-system')).toBe('blocked');
    // lobe-cloud-sandbox is now allowlisted: a share visitor's run gets its
    // own isolated per-topic sandbox session with no `lh` CLI JWT shim, so
    // it no longer belongs in the "blocked" bucket.
    expect(getShareToolAvailability('lobe-cloud-sandbox')).toBe('available');
  });

  it('leaves non-builtin identifiers to the owner picker', () => {
    expect(getShareToolAvailability('mcp-github')).toBe('available');
  });

  it('flags memory as inert until the read-memory permission is on', () => {
    expect(getShareToolAvailability(MemoryIdentifier)).toBe('needsMemoryPermission');
    expect(getShareToolAvailability(MemoryIdentifier, { allowReadMemory: true })).toBe('available');
  });
});

describe('runtimeManagedShareCandidateToolIds', () => {
  it('never suggests a tool the gate always blocks', () => {
    expect(runtimeManagedShareCandidateToolIds).not.toContain(KnowledgeBaseIdentifier);
    expect(runtimeManagedShareCandidateToolIds).not.toContain('lobe-local-system');
  });
});

describe('getVisitorVisibleEnabledToolIds', () => {
  it('hides persisted grants the gate can never honor', () => {
    expect(
      getVisitorVisibleEnabledToolIds(['mcp-github', KnowledgeBaseIdentifier, 'lobe-local-system']),
    ).toEqual(['mcp-github']);
  });

  it('tolerates an unset whitelist', () => {
    expect(getVisitorVisibleEnabledToolIds(undefined)).toEqual([]);
  });

  it('renders one identifier for a toolset with only per-API entries', () => {
    expect(
      getVisitorVisibleEnabledToolIds([
        `${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`,
        `${LobeAgentIdentifier}____${LobeAgentApiName.updatePlan}`,
      ]),
    ).toEqual([LobeAgentIdentifier]);
  });
});

describe('toggleShareToolId', () => {
  it('adds and removes over the stored array', () => {
    expect(toggleShareToolId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleShareToolId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleShareToolId(undefined, 'a')).toEqual(['a']);
  });

  it('preserves ids the picker never renders', () => {
    // `lobe-local-system` is filtered out of the display list; toggling an
    // unrelated tool must not silently drop it from the persisted whitelist.
    const stored = ['lobe-local-system', 'mcp-github'];

    expect(toggleShareToolId(stored, 'calculator')).toEqual([
      'lobe-local-system',
      'mcp-github',
      'calculator',
    ]);
    expect(toggleShareToolId(stored, 'mcp-github')).toEqual(['lobe-local-system']);
  });
});

describe('setShareToolGrant', () => {
  it('writes a bare toolset-level entry for "all"', () => {
    expect(setShareToolGrant(['calculator'], LobeAgentIdentifier, 'all')).toEqual([
      'calculator',
      LobeAgentIdentifier,
    ]);
  });

  it('writes one per-API entry per name for an array grant', () => {
    expect(
      setShareToolGrant(undefined, LobeAgentIdentifier, [LobeAgentApiName.analyzeMedia]),
    ).toEqual([`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`]);
  });

  it('removes every entry for the identifier on "none"', () => {
    const stored = [
      `${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`,
      LobeAgentIdentifier,
      'calculator',
    ];

    expect(setShareToolGrant(stored, LobeAgentIdentifier, 'none')).toEqual(['calculator']);
  });

  it('replaces a prior grant for the same identifier rather than accumulating', () => {
    const stored = [`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`];

    expect(setShareToolGrant(stored, LobeAgentIdentifier, 'all')).toEqual([LobeAgentIdentifier]);
  });
});

describe('toggleShareToolsetGrant', () => {
  it('grants everything when the identifier has no grant yet', () => {
    expect(toggleShareToolsetGrant(undefined, LobeAgentIdentifier)).toEqual([LobeAgentIdentifier]);
  });

  it('grants everything when only a partial per-API grant exists', () => {
    const stored = [`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`];

    expect(toggleShareToolsetGrant(stored, LobeAgentIdentifier)).toEqual([LobeAgentIdentifier]);
  });

  it('revokes entirely when the toolset-level entry is already granted', () => {
    expect(toggleShareToolsetGrant([LobeAgentIdentifier], LobeAgentIdentifier)).toEqual([]);
  });

  it('replaces every existing per-API entry for the identifier, not just one', () => {
    const stored = [
      `${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`,
      `${LobeAgentIdentifier}____${LobeAgentApiName.updatePlan}`,
      'calculator',
    ];

    expect(toggleShareToolsetGrant(stored, LobeAgentIdentifier)).toEqual([
      'calculator',
      LobeAgentIdentifier,
    ]);
  });
});

describe('toggleShareToolApi', () => {
  const available = [LobeAgentApiName.analyzeMedia, LobeAgentApiName.updatePlan];

  it('adds the first per-API grant for an ungranted identifier', () => {
    expect(
      toggleShareToolApi(undefined, LobeAgentIdentifier, LobeAgentApiName.analyzeMedia, available),
    ).toEqual([`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`]);
  });

  it('expands a toolset-level grant, then narrows it by the toggled API', () => {
    // Toggling one API off a toolset-level ("all") grant must narrow to the
    // REST of the available APIs, not wipe the whole grant.
    expect(
      toggleShareToolApi(
        [LobeAgentIdentifier],
        LobeAgentIdentifier,
        LobeAgentApiName.analyzeMedia,
        available,
      ),
    ).toEqual([`${LobeAgentIdentifier}____${LobeAgentApiName.updatePlan}`]);
  });

  it('stays as explicit per-API entries once every available API is individually selected, rather than collapsing to a toolset-level grant', () => {
    // Least privilege: a toolset-level entry also grants any API added to
    // this tool LATER (e.g. a plugin update) that the owner never reviewed.
    // Only the toolset chip (`toggleShareToolsetGrant`) may write `'all'`.
    const stored = [`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`];

    expect(
      toggleShareToolApi(stored, LobeAgentIdentifier, LobeAgentApiName.updatePlan, available),
    ).toEqual(
      expect.arrayContaining([
        `${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`,
        `${LobeAgentIdentifier}____${LobeAgentApiName.updatePlan}`,
      ]),
    );
  });

  it('removes the grant entirely once the last selected API is toggled off', () => {
    const stored = [`${LobeAgentIdentifier}____${LobeAgentApiName.analyzeMedia}`];

    expect(
      toggleShareToolApi(stored, LobeAgentIdentifier, LobeAgentApiName.analyzeMedia, available),
    ).toEqual([]);
  });
});

describe('getShareApiAvailability', () => {
  it('blocks callSubAgent on lobe-agent unconditionally', () => {
    expect(getShareApiAvailability(LobeAgentIdentifier, LobeAgentApiName.callSubAgent)).toBe(
      'blocked',
    );
  });

  it("blocks a 'required'/'always' humanIntervention API", () => {
    expect(
      getShareApiAvailability(LobeAgentIdentifier, LobeAgentApiName.createPlan, 'required'),
    ).toBe('blocked');
    expect(
      getShareApiAvailability(LobeAgentIdentifier, LobeAgentApiName.askUserQuestion, 'always'),
    ).toBe('blocked');
  });

  it('allows an API with no (or "never") humanIntervention', () => {
    expect(getShareApiAvailability(LobeAgentIdentifier, LobeAgentApiName.analyzeMedia)).toBe(
      'available',
    );
    expect(getShareApiAvailability(LobeAgentIdentifier, LobeAgentApiName.updatePlan, 'never')).toBe(
      'available',
    );
  });
});
