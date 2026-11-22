import { pluginPrompts } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../../engine/tools/types';
import { toToolPrompt } from '../../providers/ToolSystemRole';
import type { PipelineContext } from '../../types';
import { ToolActivationAnchorProcessor } from '../ToolActivationAnchor';

const CREDS_SYSTEM_ROLE = 'Always list credentials before creating one.';

const credsManifest = {
  api: [
    { description: 'List credentials', name: 'listCreds', parameters: {} },
    { description: 'Create a credential', name: 'createCred', parameters: {} },
  ],
  identifier: 'lobe-creds',
  meta: { title: 'Creds' },
  systemRole: CREDS_SYSTEM_ROLE,
  type: 'builtin',
} as unknown as LobeToolManifest;

const notionManifest = {
  api: [{ description: 'Create a page', name: 'createPage', parameters: {} }],
  identifier: 'notion',
  meta: { description: 'Notion workspace', title: 'Notion' },
  type: 'mcp',
} as unknown as LobeToolManifest;

const TRIMMED_RESULT =
  'Successfully activated tools: lobe-creds.listCreds, lobe-creds.createCred.\nUsage instructions for the activated items are in the system prompt.';

const createContext = (
  messages: any[],
  metadata: PipelineContext['metadata'] = {},
): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata,
});

const activation = (identifiers: string[], overrides?: Record<string, unknown>) => ({
  content: TRIMMED_RESULT,
  id: 'tool-1',
  plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
  pluginState: {
    activatedSkills: [],
    activatedTools: identifiers.map((identifier) => ({ identifier })),
  },
  role: 'tool',
  tool_call_id: 'call-1',
  ...overrides,
});

const manifests = [credsManifest, notionManifest];
const block = pluginPrompts({ tools: manifests.map(toToolPrompt) });
const system = { role: 'system', content: 'Agent instructions\n\n' + block };
const process = (messages: PipelineContext['messages']) =>
  new ToolActivationAnchorProcessor({ manifests }).process(createContext(messages));

describe('ToolActivationAnchorProcessor', () => {
  it('leaves the canonical messages intact and prepares each tool at its first surviving activation', async () => {
    const first = activation(['lobe-creds']);
    const second = activation(['lobe-creds', 'notion'], { tool_call_id: 'call-2' });
    const result = await process([system, first, second]);
    expect(result.messages[0]).toEqual(system);
    expect(result.messages[1].content).toBe(first.content);
    expect(result.messages[2]).toEqual(second);
    const plan = result.messages[1].toolActivationPlan;
    expect(plan.results.map((entry: { toolNames: string[] }) => entry.toolNames)).toEqual([
      ['lobe-creds____listCreds', 'lobe-creds____createCred'],
      ['notion____createPage____mcp'],
    ]);
    expect(plan.results[0].content).toContain(CREDS_SYSTEM_ROLE);
    expect(plan.results[0].content).not.toContain('in the system prompt');
    expect(plan.results[1].content).not.toContain(CREDS_SYSTEM_ROLE);
    expect(plan.results[1].content).toContain('Notion workspace');
    expect(system.content.replace(plan.system.original, plan.system.replacement)).toBe(
      'Agent instructions',
    );
    expect(first).not.toHaveProperty('toolActivationPlan');
  });

  it('prepares no edit for absent, disabled or unrelated activations', async () => {
    const messages = [
      system,
      activation(['uninstalled']),
      activation(['notion'], { plugin: { identifier: 'other', apiName: 'run' } }),
    ];
    expect((await process(messages)).messages).toEqual(messages);
  });

  it('leaves a replaced or ambiguous system prompt intact', async () => {
    for (const content of ['custom agent document', block + '\n\n' + block]) {
      const messages = [{ role: 'system', content }, activation(['notion'])];
      expect((await process(messages)).messages).toEqual(messages);
    }
  });

  it('keeps an explicit replacement document and prepares guidance at the activation', async () => {
    const document = { role: 'system', content: 'Custom agent document' };
    const result = await new ToolActivationAnchorProcessor({ manifests }).process(
      createContext([document, activation(['lobe-creds'])], {
        agentDocumentSystemReplace: { replaced: true },
      }),
    );
    expect(result.messages[0]).toEqual(document);
    expect(result.messages[1].toolActivationPlan).not.toHaveProperty('system');
    expect(result.messages[1].toolActivationPlan.results[0].content).toContain(CREDS_SYSTEM_ROLE);
  });

  it('preserves skill guidance in a mixed activation', async () => {
    const result = await process([
      system,
      activation(['notion'], {
        pluginState: {
          activatedSkills: [{ name: 'Skill' }],
          activatedTools: [{ identifier: 'notion' }],
        },
      }),
    ]);
    expect(result.messages[1].toolActivationPlan.results[0].content).toContain('skill');
  });
});
