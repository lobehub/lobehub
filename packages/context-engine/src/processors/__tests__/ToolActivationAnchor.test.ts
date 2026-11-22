import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../../engine/tools/types';
import type { PipelineContext } from '../../types';
import { collectActivatedToolIds } from '../../utils/activatedTools';
import {
  ACTIVATION_DOCS_FOLLOW_NOTE,
  ACTIVATION_DOCS_FOLLOW_WITH_SKILLS_NOTE,
  ToolActivationAnchorProcessor,
} from '../ToolActivationAnchor';

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

const process = (messages: any[], relocated: string[] = []) =>
  new ToolActivationAnchorProcessor({ manifests: [credsManifest, notionManifest] }).process(
    createContext(
      messages,
      relocated.length > 0 ? { toolActivationAnchors: { toolIds: relocated } } : {},
    ),
  );

describe('ToolActivationAnchorProcessor', () => {
  it('names the functions an activation made callable, as the tools array spells them', async () => {
    const result = await process([activation(['lobe-creds', 'notion'])]);

    expect(result.messages[0].toolsAdded).toEqual([
      'lobe-creds____listCreds',
      'lobe-creds____createCred',
      'notion____createPage____mcp',
    ]);
    // Instructions stay wherever they were unless the system message dropped them.
    expect(result.messages[0].content).toBe(TRIMMED_RESULT);
  });

  it('keeps the instructions with the result when the system message left them out', async () => {
    const result = await process([activation(['lobe-creds'])], ['lobe-creds']);

    const content = result.messages[0].content as string;
    expect(content).toContain(ACTIVATION_DOCS_FOLLOW_NOTE);
    expect(content).not.toContain('in the system prompt');
    expect(content).toContain(CREDS_SYSTEM_ROLE);
    expect(content.startsWith('Successfully activated tools:')).toBe(true);
  });

  it('still points at the system prompt for skills activated by the same call', async () => {
    const result = await process(
      [
        activation(['lobe-creds'], {
          pluginState: {
            activatedSkills: [{ name: 'PowerShell' }],
            activatedTools: [{ identifier: 'lobe-creds' }],
          },
        }),
      ],
      ['lobe-creds'],
    );

    expect(result.messages[0].content).toContain(ACTIVATION_DOCS_FOLLOW_WITH_SKILLS_NOTE);
  });

  it('renders the same text on every request', async () => {
    const first = await process([activation(['lobe-creds'])], ['lobe-creds']);
    const second = await process([activation(['lobe-creds'])], ['lobe-creds']);

    expect(second.messages[0].content).toBe(first.messages[0].content);
  });

  it('anchors a tool once, at the first result that activated it', async () => {
    const result = await process(
      [
        activation(['lobe-creds']),
        activation(['lobe-creds', 'notion'], { id: 'tool-2', tool_call_id: 'call-2' }),
      ],
      ['lobe-creds', 'notion'],
    );

    expect(result.messages[0].toolsAdded).toEqual([
      'lobe-creds____listCreds',
      'lobe-creds____createCred',
    ]);
    expect(result.messages[1].toolsAdded).toEqual(['notion____createPage____mcp']);
    expect(result.messages[1].content).not.toContain(CREDS_SYSTEM_ROLE);
    expect(result.messages[1].content).toContain('Notion workspace');
  });

  it('leaves results alone when the activated tool is not enabled for this request', async () => {
    const message = activation(['uninstalled-tool']);
    const result = await process([message]);

    expect(result.messages[0]).toEqual(message);
  });

  it('ignores other tool results', async () => {
    const message = {
      content: 'done',
      plugin: { apiName: 'listCreds', identifier: 'lobe-creds' },
      pluginState: { activatedTools: [{ identifier: 'notion' }] },
      role: 'tool',
      tool_call_id: 'call-9',
    };
    const result = await process([message]);

    expect(result.messages[0]).toEqual(message);
  });

  it('puts the instructions back in the system message when the result is gone', async () => {
    const result = await process(
      [
        { content: 'You are a helpful assistant.', role: 'system' },
        { content: 'list my creds', role: 'user' },
      ],
      ['lobe-creds'],
    );

    expect(result.messages[0].content).toContain('You are a helpful assistant.');
    expect(result.messages[0].content).toContain(CREDS_SYSTEM_ROLE);
    expect(result.metadata.toolActivationAnchor?.fallbackToolIds).toEqual(['lobe-creds']);
  });
});

describe('collectActivatedToolIds', () => {
  it('reads flat tool rows and tools nested in an assistant group', () => {
    const ids = collectActivatedToolIds([
      activation(['lobe-creds']),
      {
        children: [
          {
            tools: [
              {
                apiName: 'activateTools',
                identifier: 'lobe-activator',
                result: { state: { activatedTools: [{ identifier: 'notion' }] } },
              },
              {
                apiName: 'createPage',
                identifier: 'notion',
                result: { state: { activatedTools: [{ identifier: 'ignored' }] } },
              },
            ],
          },
        ],
        content: '',
        role: 'assistantGroup',
      },
    ]);

    expect(ids).toEqual(['lobe-creds', 'notion']);
  });

  it('skips results inside a compressed group, which reaches the model as a summary', () => {
    const ids = collectActivatedToolIds([
      {
        compressedMessages: [activation(['lobe-creds'])],
        content: 'summary',
        role: 'compressedGroup',
      },
    ]);

    expect(ids).toEqual([]);
  });
});
