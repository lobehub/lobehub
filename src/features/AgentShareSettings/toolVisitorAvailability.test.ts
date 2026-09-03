import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { describe, expect, it } from 'vitest';

import {
  getShareApiAvailability,
  getShareToolAvailability,
  getVisitorVisibleGrantedToolIds,
  runtimeManagedShareCandidateToolIds,
  setShareToolGrant,
  toggleShareToolApi,
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

describe('getVisitorVisibleGrantedToolIds', () => {
  it('hides persisted grants the gate can never honor', () => {
    expect(
      getVisitorVisibleGrantedToolIds([
        { identifier: 'mcp-github' },
        { identifier: KnowledgeBaseIdentifier },
        { identifier: 'lobe-local-system' },
      ]),
    ).toEqual(['mcp-github']);
  });

  it('tolerates an unset grant list', () => {
    expect(getVisitorVisibleGrantedToolIds(undefined)).toEqual([]);
  });

  it('renders one identifier for a toolset granted only per-API', () => {
    expect(
      getVisitorVisibleGrantedToolIds([
        {
          apis: [LobeAgentApiName.analyzeMedia, LobeAgentApiName.updatePlan],
          identifier: LobeAgentIdentifier,
        },
      ]),
    ).toEqual([LobeAgentIdentifier]);
  });
});

describe('setShareToolGrant', () => {
  it('writes an `apis`-less entry for "all"', () => {
    expect(setShareToolGrant([{ identifier: 'calculator' }], LobeAgentIdentifier, 'all')).toEqual([
      { identifier: 'calculator' },
      { identifier: LobeAgentIdentifier },
    ]);
  });

  it('writes one `apis`-scoped entry for an array grant', () => {
    expect(
      setShareToolGrant(undefined, LobeAgentIdentifier, [LobeAgentApiName.analyzeMedia]),
    ).toEqual([{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }]);
  });

  it('drops the identifier entirely on "none"', () => {
    const stored = [
      { apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier },
      { identifier: 'calculator' },
    ];

    expect(setShareToolGrant(stored, LobeAgentIdentifier, 'none')).toEqual([
      { identifier: 'calculator' },
    ]);
  });

  it('replaces a prior grant for the same identifier rather than accumulating', () => {
    const stored = [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }];

    expect(setShareToolGrant(stored, LobeAgentIdentifier, 'all')).toEqual([
      { identifier: LobeAgentIdentifier },
    ]);
  });
});

describe('toggleShareToolsetGrant', () => {
  it('grants everything when the identifier has no grant yet', () => {
    expect(toggleShareToolsetGrant(undefined, LobeAgentIdentifier)).toEqual([
      { identifier: LobeAgentIdentifier },
    ]);
  });

  it('grants everything when only a partial per-API grant exists', () => {
    const stored = [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }];

    expect(toggleShareToolsetGrant(stored, LobeAgentIdentifier)).toEqual([
      { identifier: LobeAgentIdentifier },
    ]);
  });

  it('revokes entirely when every API is already granted', () => {
    expect(
      toggleShareToolsetGrant([{ identifier: LobeAgentIdentifier }], LobeAgentIdentifier),
    ).toEqual([]);
  });

  it('leaves grants for other identifiers untouched', () => {
    const stored = [
      { apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier },
      { identifier: 'calculator' },
    ];

    expect(toggleShareToolsetGrant(stored, LobeAgentIdentifier)).toEqual([
      { identifier: 'calculator' },
      { identifier: LobeAgentIdentifier },
    ]);
  });
});

describe('toggleShareToolApi', () => {
  const available = [LobeAgentApiName.analyzeMedia, LobeAgentApiName.updatePlan];

  it('adds the first per-API grant for an ungranted identifier', () => {
    expect(
      toggleShareToolApi(undefined, LobeAgentIdentifier, LobeAgentApiName.analyzeMedia, available),
    ).toEqual([{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }]);
  });

  it('expands a toolset-level grant, then narrows it by the toggled API', () => {
    // Toggling one API off a toolset-level ("all") grant must narrow to the
    // REST of the available APIs, not wipe the whole grant.
    expect(
      toggleShareToolApi(
        [{ identifier: LobeAgentIdentifier }],
        LobeAgentIdentifier,
        LobeAgentApiName.analyzeMedia,
        available,
      ),
    ).toEqual([{ apis: [LobeAgentApiName.updatePlan], identifier: LobeAgentIdentifier }]);
  });

  it('stays an explicit `apis` list once every available API is individually selected, rather than collapsing to a toolset-level grant', () => {
    // Least privilege: an `apis`-less entry also grants any API added to this
    // tool LATER (e.g. a plugin update) that the owner never reviewed. Only
    // the toolset chip (`toggleShareToolsetGrant`) may write `'all'`.
    const stored = [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }];

    expect(
      toggleShareToolApi(stored, LobeAgentIdentifier, LobeAgentApiName.updatePlan, available),
    ).toEqual([
      {
        apis: expect.arrayContaining([LobeAgentApiName.analyzeMedia, LobeAgentApiName.updatePlan]),
        identifier: LobeAgentIdentifier,
      },
    ]);
  });

  it('removes the grant entirely once the last selected API is toggled off', () => {
    const stored = [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }];

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

  // A share grant is read-only at most: the server gate strips every memory
  // write API regardless of what the owner ticked, so the picker must not
  // offer them (regression: owners granted only write APIs and saw no memory
  // tool on the visitor side at all).
  it('reports memory write APIs as writesOwnerData, keeps read APIs available', () => {
    for (const apiName of [
      MemoryApiName.addPreferenceMemory,
      MemoryApiName.updateIdentityMemory,
      MemoryApiName.removeIdentityMemory,
    ]) {
      expect(getShareApiAvailability(MemoryIdentifier, apiName)).toBe('writesOwnerData');
    }
    expect(getShareApiAvailability(MemoryIdentifier, MemoryApiName.searchUserMemory)).toBe(
      'available',
    );
    expect(getShareApiAvailability(MemoryIdentifier, MemoryApiName.queryTaxonomyOptions)).toBe(
      'available',
    );
  });
});
