import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import {
  KnowledgeBaseApiName,
  KnowledgeBaseIdentifier,
} from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { SkillsApiName, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  builtinTools,
} from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import { isShareBlockedBuiltinDispatch, isShareBlockedDataToolCall } from '.';

describe('AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS', () => {
  it('only names identifiers that exist in the real builtin registry', () => {
    const registered = new Set(builtinTools.map((tool) => tool.identifier));

    for (const identifier of AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS) {
      expect(registered.has(identifier), `${identifier} is not a registered builtin`).toBe(true);
    }
  });

  it('does not allowlist the confirmed creator-data leak tools', () => {
    for (const identifier of [
      AgentManagementIdentifier,
      'lobe-local-system',
      'lobe-creds',
      'lobe-task',
      TopicReferenceIdentifier,
    ]) {
      expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(identifier)).toBe(false);
    }
  });

  // `lobe-cloud-sandbox` is allowlisted despite its general-purpose reach: a
  // share visitor's run gets an isolated per-topic sandbox session with no
  // `lh` CLI JWT shim, so it cannot mint or exfiltrate the creator's
  // credentials — see the allowed-builtins section of `README.md`.
  it('allowlists lobe-cloud-sandbox now that visitor runs get a credential-free sandbox session', () => {
    expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has('lobe-cloud-sandbox')).toBe(true);
  });

  it('allowlists video generation but still requires the owner grant to dispatch it', () => {
    expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has('lobe-video-generation')).toBe(true);
    expect(isShareBlockedBuiltinDispatch({}, 'lobe-video-generation', 'generateVideo')).toBe(true);
    expect(
      isShareBlockedBuiltinDispatch(
        { toolGrants: [{ identifier: 'lobe-video-generation' }] },
        'lobe-video-generation',
        'generateVideo',
      ),
    ).toBe(false);
  });
});

/**
 * The owner-facing share settings tool picker renders this set as permanently
 * unavailable. If a grant here is ever relaxed server-side without updating
 * the exported set, the UI would start offering a toggle the gate still
 * ignores — so pin the two together.
 */
describe('AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS', () => {
  const maximalPermissions = {
    allowReadMemory: true,
    knowledgeBaseIds: ['kb1'],
    // `lobe-skills` has its own opt-in — the skill list, not `toolGrants` — so
    // "maximal" has to name a skill or the tool reads as unconditionally
    // blocked and lands in this set by accident.
    skillGrants: ['pdf-report'],
    toolGrants: [{ identifier: AgentDocumentsIdentifier }],
  };

  it('names only allowlisted identifiers', () => {
    for (const identifier of AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS) {
      expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(identifier)).toBe(true);
    }
  });

  it('matches exactly the allowlisted identifiers blocked under maximal permissions', () => {
    // `readOnlyApiName` stands in for any API: an unconditional `none` grant
    // blocks the identifier before the per-API rules are ever consulted.
    const blockedUnderMaximalPermissions = [...AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS].filter(
      (identifier) => isShareBlockedDataToolCall(maximalPermissions, identifier, 'readOnlyApiName'),
    );

    expect(new Set(blockedUnderMaximalPermissions)).toEqual(
      AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
    );
  });

  it('excludes memory, whose grant is conditional on allowReadMemory', () => {
    expect(AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS.has(MemoryIdentifier)).toBe(false);
  });

  it('excludes Agent Documents, whose grant enables only share-scoped authoring APIs', () => {
    expect(AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS.has(AgentDocumentsIdentifier)).toBe(false);
  });
});

describe('isShareBlockedDataToolCall', () => {
  it('lets non-builtin identifiers through untouched', () => {
    expect(isShareBlockedDataToolCall({}, 'mcp-github', 'anything')).toBe(false);
  });

  it('default-denies any builtin outside the allowlist', () => {
    expect(isShareBlockedDataToolCall({}, AgentManagementIdentifier, 'searchAgent')).toBe(true);
  });

  it('allows an allowlisted builtin with no data rule', () => {
    expect(isShareBlockedDataToolCall({}, CalculatorIdentifier, 'calculate')).toBe(false);
  });

  describe('memory', () => {
    it('blocks every api without allowReadMemory', () => {
      expect(isShareBlockedDataToolCall({}, MemoryIdentifier, MemoryApiName.searchUserMemory)).toBe(
        true,
      );
    });

    it('allows reads but never writes with allowReadMemory', () => {
      const permissions = { allowReadMemory: true };

      expect(
        isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.searchUserMemory),
      ).toBe(false);
      expect(
        isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.addContextMemory),
      ).toBe(true);
    });
  });

  it('keeps Agent Documents closed by default, then allows only its scoped authoring APIs', () => {
    expect(
      isShareBlockedDataToolCall({}, AgentDocumentsIdentifier, AgentDocumentsApiName.listDocuments),
    ).toBe(true);

    const permissions = { toolGrants: [{ identifier: AgentDocumentsIdentifier }] };
    for (const apiName of [
      AgentDocumentsApiName.createDocument,
      AgentDocumentsApiName.readDocument,
      AgentDocumentsApiName.listDocuments,
      AgentDocumentsApiName.modifyNodes,
      AgentDocumentsApiName.replaceDocumentContent,
      AgentDocumentsApiName.renameDocument,
    ]) {
      expect(isShareBlockedDataToolCall(permissions, AgentDocumentsIdentifier, apiName)).toBe(
        false,
      );
    }
    for (const apiName of [
      AgentDocumentsApiName.copyDocument,
      AgentDocumentsApiName.removeDocument,
      AgentDocumentsApiName.updateLoadRule,
    ]) {
      expect(isShareBlockedDataToolCall(permissions, AgentDocumentsIdentifier, apiName)).toBe(true);
    }
  });

  it('blocks knowledge base outright (no grant exists)', () => {
    expect(
      isShareBlockedDataToolCall(
        { allowReadMemory: true, knowledgeBaseIds: ['kb1'] },
        KnowledgeBaseIdentifier,
        KnowledgeBaseApiName.viewKnowledgeBase,
        { id: 'kb1' },
      ),
    ).toBe(true);
  });
});

// Dispatch-time full gate, asserted against the REAL manifests: a call that
// bypassed assembly must clear the master allowlist, the owner's
// toolGrants picker, sub-agent dispatch, and the data-tool rules — in that
// order, all fail-closed. `humanIntervention` is not a dispatch rule: the
// runtime parks those calls for the visitor's approval first.
describe('isShareBlockedBuiltinDispatch', () => {
  it('blocks an allowlisted builtin the owner did not enable', () => {
    expect(isShareBlockedBuiltinDispatch({}, CalculatorIdentifier, 'evalExpression')).toBe(true);
  });

  it('passes an enabled builtin with no intervention semantics', () => {
    expect(
      isShareBlockedBuiltinDispatch(
        { toolGrants: [{ identifier: LobeAgentIdentifier }] },
        LobeAgentIdentifier,
        LobeAgentApiName.analyzeMedia,
      ),
    ).toBe(false);
  });

  it('passes an approved intervention-gated API on an enabled tool', () => {
    for (const apiName of [LobeAgentApiName.createPlan, LobeAgentApiName.askUserQuestion]) {
      expect(
        isShareBlockedBuiltinDispatch(
          { toolGrants: [{ identifier: LobeAgentIdentifier }] },
          LobeAgentIdentifier,
          apiName,
        ),
      ).toBe(false);
    }
  });

  it('blocks sub-agent dispatch even on an enabled tool with no intervention config', () => {
    // callSubAgent carries no humanIntervention, so neither the approval
    // flow nor the data-tool rules would catch it — and the child run it
    // spawns does not inherit the parent's shareGate. Must be blocked by its
    // dedicated dispatch rule.
    expect(
      isShareBlockedBuiltinDispatch(
        { toolGrants: [{ identifier: LobeAgentIdentifier }] },
        LobeAgentIdentifier,
        LobeAgentApiName.callSubAgent,
      ),
    ).toBe(true);
  });

  it('still applies the data-tool rules after the enable check', () => {
    const enabled = { toolGrants: [{ identifier: MemoryIdentifier }] };

    expect(
      isShareBlockedBuiltinDispatch(enabled, MemoryIdentifier, MemoryApiName.searchUserMemory),
    ).toBe(true);
    expect(
      isShareBlockedBuiltinDispatch(
        { ...enabled, allowReadMemory: true },
        MemoryIdentifier,
        MemoryApiName.searchUserMemory,
      ),
    ).toBe(false);
    expect(
      isShareBlockedBuiltinDispatch(
        { ...enabled, allowReadMemory: true },
        MemoryIdentifier,
        MemoryApiName.addContextMemory,
      ),
    ).toBe(true);
  });

  it('allows granted Agent Documents authoring APIs but blocks destructive and policy APIs', () => {
    const enabled = { toolGrants: [{ identifier: AgentDocumentsIdentifier }] };

    expect(
      isShareBlockedBuiltinDispatch(
        enabled,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.createDocument,
      ),
    ).toBe(false);
    expect(
      isShareBlockedBuiltinDispatch(
        enabled,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.renameDocument,
      ),
    ).toBe(false);
    expect(
      isShareBlockedBuiltinDispatch(
        enabled,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.removeDocument,
      ),
    ).toBe(true);
    expect(
      isShareBlockedBuiltinDispatch(
        enabled,
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.updateLoadRule,
      ),
    ).toBe(true);
  });

  it('allows the two Skills read APIs but blocks the exec-class and export ones', () => {
    const enabled = { skillGrants: ['pdf-report'] };

    for (const apiName of [SkillsApiName.activateSkill, SkillsApiName.readReference]) {
      expect(isShareBlockedBuiltinDispatch(enabled, SkillsIdentifier, apiName)).toBe(false);
    }
    // runCommand/execScript run arbitrary code on the creator's account and
    // exportFile writes to the creator's file store — all three are phase-2
    // work, gated here rather than merely omitted from the assembled manifest.
    for (const apiName of [
      SkillsApiName.runCommand,
      SkillsApiName.execScript,
      SkillsApiName.exportFile,
    ]) {
      expect(isShareBlockedBuiltinDispatch(enabled, SkillsIdentifier, apiName)).toBe(true);
    }
  });

  it('blocks every Skills API when the owner revoked or never granted a skill', () => {
    // A tool grant is included on purpose: `toolGrants` never authorizes a
    // skill, so it cannot unblock these APIs either.
    for (const permissions of [{}, { skillGrants: [] }, { toolGrants: [{ identifier: 'x' }] }]) {
      expect(
        isShareBlockedBuiltinDispatch(permissions, SkillsIdentifier, SkillsApiName.activateSkill),
      ).toBe(true);
    }
  });

  it('ignores non-builtin identifiers entirely', () => {
    expect(isShareBlockedBuiltinDispatch({}, 'some-mcp-server', 'anything')).toBe(false);
  });

  it('blocks a builtin outside the master allowlist regardless of enablement', () => {
    expect(
      isShareBlockedBuiltinDispatch(
        { toolGrants: [{ identifier: AgentManagementIdentifier }] },
        AgentManagementIdentifier,
        'searchAgent',
      ),
    ).toBe(true);
  });

  it('a per-API grant grants only the named API, not the whole identifier', () => {
    const enabled = {
      toolGrants: [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }],
    };

    expect(
      isShareBlockedBuiltinDispatch(enabled, LobeAgentIdentifier, LobeAgentApiName.analyzeMedia),
    ).toBe(false);
    // updatePlan carries no intervention config either, so only the picker's
    // per-API scoping is what blocks it here.
    expect(
      isShareBlockedBuiltinDispatch(enabled, LobeAgentIdentifier, LobeAgentApiName.updatePlan),
    ).toBe(true);
  });
});
