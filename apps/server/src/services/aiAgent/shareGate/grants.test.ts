import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { describe, expect, it } from 'vitest';

import {
  applyShareGateToAgentConfig,
  filterPluginsByShareGate,
  filterSkillsByShareGate,
  getShareGrantActivatedPluginIds,
  shareGateGrantsCloudSandbox,
} from '.';
import { buildGate } from './testUtils';

describe('filterPluginsByShareGate', () => {
  it('keeps only allowlisted plugin ids', () => {
    const gate = buildGate({
      toolGrants: [{ identifier: 'web-search' }, { identifier: 'mcp-github' }],
    });

    expect(filterPluginsByShareGate(['web-search', 'local-system', 'mcp-github'], gate)).toEqual([
      'web-search',
      'mcp-github',
    ]);
  });

  it('exposes no tools when the allowlist is missing or empty', () => {
    expect(filterPluginsByShareGate(['web-search'], buildGate())).toEqual([]);
    expect(filterPluginsByShareGate(['web-search'], buildGate({ toolGrants: [] }))).toEqual([]);
  });

  it('treats a per-API grant as candidacy for the whole identifier', () => {
    // Narrowing down to the specific granted API happens later, in
    // `applyShareGateToToolSet`, once the real manifest is known — this pass
    // only decides whether the identifier is a candidate at all.
    const gate = buildGate({
      toolGrants: [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }],
    });

    expect(filterPluginsByShareGate([LobeAgentIdentifier, 'mcp-github'], gate)).toEqual([
      LobeAgentIdentifier,
    ]);
  });
});

describe('filterSkillsByShareGate', () => {
  it('keeps only the skills the creator named', () => {
    const gate = buildGate({ skillGrants: ['pdf-report', 'brand-voice'] });

    expect(filterSkillsByShareGate(['pdf-report', 'internal-audit', 'brand-voice'], gate)).toEqual([
      'pdf-report',
      'brand-voice',
    ]);
  });

  it('cannot turn an ordinary tool grant into a skill grant', () => {
    // `toolGrants` is never read as a skill list. Tool and skill ids share one
    // namespace, so a tool grant that happens to name a real skill id must not
    // widen the skill pool either.
    const gate = buildGate({ toolGrants: [{ identifier: 'pdf-report' }] });

    expect(filterSkillsByShareGate(['pdf-report'], gate)).toEqual([]);
  });

  it('exposes no skills when the share grants nothing at all', () => {
    expect(filterSkillsByShareGate(['pdf-report'], buildGate())).toEqual([]);
    expect(filterSkillsByShareGate(['pdf-report'], buildGate({ skillGrants: [] }))).toEqual([]);
  });
});

describe('getShareGrantActivatedPluginIds', () => {
  it('activates Agent Documents only after the owner grants it for this Share', () => {
    expect(getShareGrantActivatedPluginIds(buildGate())).toEqual([]);
    expect(
      getShareGrantActivatedPluginIds(
        buildGate({ toolGrants: [{ identifier: AgentDocumentsIdentifier }] }),
      ),
    ).toEqual([AgentDocumentsIdentifier]);
  });
});

describe('applyShareGateToAgentConfig', () => {
  it('always strips files and knowledge bases', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(agentConfig);

    expect(agentConfig.files).toEqual([]);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });
});

describe('shareGateGrantsCloudSandbox', () => {
  it('is false when the share does not grant lobe-cloud-sandbox', () => {
    expect(shareGateGrantsCloudSandbox(buildGate())).toBe(false);
    expect(
      shareGateGrantsCloudSandbox(buildGate({ toolGrants: [{ identifier: 'web-search' }] })),
    ).toBe(false);
  });

  it('is true for a whole-identifier grant', () => {
    expect(
      shareGateGrantsCloudSandbox(
        buildGate({ toolGrants: [{ identifier: CloudSandboxManifest.identifier }] }),
      ),
    ).toBe(true);
  });

  // The plan only needs to know the sandbox is in play at all — narrowing to
  // the granted APIs happens later in `applyShareGateToToolSet`.
  it('treats an apis-scoped grant as a grant of the identifier', () => {
    expect(
      shareGateGrantsCloudSandbox(
        buildGate({
          toolGrants: [{ apis: ['runCommand'], identifier: CloudSandboxManifest.identifier }],
        }),
      ),
    ).toBe(true);
  });
});
