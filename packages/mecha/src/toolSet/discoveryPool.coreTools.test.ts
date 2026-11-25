import { AttachmentsManifest } from '@lobechat/builtin-tool-attachments';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { createEnableChecker, ToolsEngine } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { initialToolSelection } from './discoveryPool';
import { assembleManifestPool } from './manifestPool';
import { resolveToolRules } from './resolveToolRules';
import type { ToolRuleRequest } from './types';

const firstRequestFunctions = (overrides: Partial<ToolRuleRequest> = {}) => {
  const request: ToolRuleRequest = {
    agent: { chatConfig: { enableAgentMode: true }, plugins: [] },
    executionTarget: 'local',
    hasEnabledKnowledgeBases: true,
    hasOversizedFiles: true,
    localExecutionReady: true,
    memoryEnabled: true,
    model: { canUseFC: true },
    ...overrides,
  };
  const policy = resolveToolRules(request);
  const engine = new ToolsEngine({
    defaultToolIds: policy.defaultToolIds,
    enableChecker: createEnableChecker({ rules: policy.rules }),
    functionCallChecker: () => request.model.canUseFC,
    manifestSchemas: assembleManifestPool(
      {
        additional: [
          AttachmentsManifest,
          CloudSandboxManifest,
          KnowledgeBaseManifest,
          LocalSystemManifest,
          MemoryManifest,
          WebBrowsingManifest,
        ],
      },
      { excludedIdentifiers: policy.excludedIdentifiers },
    ).manifests,
  });
  return (
    engine
      .generateToolsDetailed({
        model: 'gpt-4',
        provider: 'openai',
        ...initialToolSelection(request.agent.plugins, request.agent.chatConfig),
      })
      .tools?.map((tool) => tool.function.name) ?? []
  );
};

describe('first-call core tools', () => {
  it('can read a local file and page a large attachment without an activation turn', () => {
    const functions = firstRequestFunctions();
    expect(functions).toContain('lobe-local-system____readFile');
    expect(functions).toContain('lobe-attachments____readAttachment');
    expect(functions.some((name) => name.startsWith('lobe-web-browsing____'))).toBe(true);
    expect(
      functions.some(
        (name) =>
          name.startsWith('lobe-knowledge-base____') || name.startsWith('lobe-user-memory____'),
      ),
    ).toBe(false);
    expect(functions).not.toContain('lobe-cloud-sandbox____executeCode');
  });

  it('can execute in the selected sandbox without predeclaring a local executor', () => {
    const functions = firstRequestFunctions({ executionTarget: 'sandbox' });
    expect(functions).toContain('lobe-cloud-sandbox____executeCode');
    expect(functions).not.toContain('lobe-local-system____readFile');
  });

  it('keeps unready devices, small attachments and revoked tools out of the request', () => {
    const functions = firstRequestFunctions({
      localExecutionReady: false,
      hasOversizedFiles: false,
      disabledPluginIds: ['lobe-web-browsing'],
    });
    expect(functions).not.toContain('lobe-local-system____readFile');
    expect(functions).not.toContain('lobe-attachments____readAttachment');
    expect(functions.some((name) => name.startsWith('lobe-web-browsing____'))).toBe(false);
  });

  it('keeps Chat on its existing whitelist and does not add execution tools', () => {
    const functions = firstRequestFunctions({
      agent: { chatConfig: { enableAgentMode: false }, plugins: [] },
    });
    expect(functions).toContain('lobe-attachments____readAttachment');
    expect(functions.some((name) => name.startsWith('lobe-knowledge-base____'))).toBe(true);
    expect(functions).not.toContain('lobe-local-system____readFile');
  });

  it('does not widen an explicitly custom toolset', () => {
    const functions = firstRequestFunctions({
      agent: { chatConfig: { toolMode: 'custom' }, plugins: ['lobe-web-browsing'] },
    });
    expect(functions.some((name) => name.startsWith('lobe-web-browsing____'))).toBe(true);
    expect(functions).not.toContain('lobe-local-system____readFile');
    expect(functions).not.toContain('lobe-attachments____readAttachment');
  });
});
