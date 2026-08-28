import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../../engine/tools/types';
import type { SkillMeta } from '../../providers/SkillContextProvider';
import type { PipelineContext } from '../../types';
import { ActivationResultTrimProcessor } from '../ActivationResultTrim';

const CREDS_SYSTEM_ROLE = 'lobe-creds instructions: manage credentials carefully.\n'.repeat(20);
const SKILL_CONTENT = '# PowerShell Skill\n\nRun PowerShell commands safely.\n'.repeat(20);
const RESOURCE_TREE = '<resources skill="PowerShell">\n- scripts/run.ps1\n</resources>';

const credsManifest = {
  api: [
    { description: 'List credentials', name: 'listCreds' },
    { description: 'Create a credential', name: 'createCred' },
  ],
  identifier: 'lobe-creds',
  meta: { title: 'Creds' },
  systemRole: CREDS_SYSTEM_ROLE,
} as unknown as LobeToolManifest;

const powershellSkill: SkillMeta = {
  activated: true,
  content: SKILL_CONTENT,
  description: 'Run PowerShell',
  identifier: 'powershell',
  name: 'PowerShell',
};

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const activateToolsMessage = (overrides?: Record<string, unknown>) => ({
  content: `Successfully activated tools:\n\n## Creds (lobe-creds)\n${CREDS_SYSTEM_ROLE}\n\nAvailable APIs:\n- **listCreds**: List credentials\n- **createCred**: Create a credential`,
  id: 'tool-1',
  plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
  pluginState: {
    activatedSkills: [],
    activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
    alreadyActive: [],
    notFound: [],
  },
  role: 'tool',
  tool_call_id: 'call-1',
  ...overrides,
});

const activateSkillMessage = (overrides?: Record<string, unknown>) => ({
  content: `${SKILL_CONTENT}\n\n${RESOURCE_TREE}`,
  id: 'tool-2',
  plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
  pluginState: { hasResources: true, name: 'PowerShell', source: 'user' },
  role: 'tool',
  tool_call_id: 'call-2',
  ...overrides,
});

describe('ActivationResultTrimProcessor', () => {
  describe('activateTools results', () => {
    it('should trim the result to a short confirmation when the manifest is injected', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [credsManifest] });
      const result = await processor.process(createContext([activateToolsMessage()]));

      const content = result.messages[0].content as string;
      expect(content).not.toContain(CREDS_SYSTEM_ROLE);
      expect(content).toContain(
        'Successfully activated tools: lobe-creds.listCreds, lobe-creds.createCred.',
      );
      expect(content).toContain('in the system prompt');
      expect(result.metadata.activationResultTrim?.trimmedMessages).toBe(1);
      expect(result.metadata.activationResultTrim?.savedChars).toBeGreaterThan(0);
    });

    it('should keep already-active and not-found details in the confirmation', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [credsManifest] });
      const result = await processor.process(
        createContext([
          activateToolsMessage({
            pluginState: {
              activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
              alreadyActive: ['github'],
              notFound: ['nonexistent'],
            },
          }),
        ]),
      );

      const content = result.messages[0].content as string;
      expect(content).toContain('Already active: github.');
      expect(content).toContain('Not found: nonexistent.');
    });

    it('should NOT trim when an activated tool is not injected into the system prompt', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [] });
      const original = activateToolsMessage();
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });

    it('should NOT trim when a fallback-activated skill is not injected', async () => {
      // activateTools content is a single blob; a partially covered activation
      // must keep the full text as the only channel for the uncovered skill.
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [credsManifest] });
      const original = activateToolsMessage({
        pluginState: {
          activatedSkills: [{ name: 'agent-browser' }],
          activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
        },
      });
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });

    it('should trim fallback-activated skills when they are injected too', async () => {
      const processor = new ActivationResultTrimProcessor({
        injectedManifests: [credsManifest],
        injectedSkills: [powershellSkill],
      });
      const result = await processor.process(
        createContext([
          activateToolsMessage({
            content: `Successfully activated tools:\n\n## Creds (lobe-creds)\n${CREDS_SYSTEM_ROLE}\n${SKILL_CONTENT}`,
            pluginState: {
              activatedSkills: [{ name: 'PowerShell' }],
              activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
            },
          }),
        ]),
      );

      const content = result.messages[0].content as string;
      expect(content).not.toContain(CREDS_SYSTEM_ROLE);
      expect(content).not.toContain(SKILL_CONTENT);
      expect(content).toContain('Activated skills: PowerShell.');
    });

    it('should preserve a fallback-activated skill suffix beyond the injected content', async () => {
      // Resource tree / project directory hints are appended to the fallback
      // activation content but are NOT part of the injected skill.content.
      const processor = new ActivationResultTrimProcessor({
        injectedManifests: [credsManifest],
        injectedSkills: [powershellSkill],
      });
      const result = await processor.process(
        createContext([
          activateToolsMessage({
            content: `Successfully activated tools:\n\n## Creds (lobe-creds)\n${CREDS_SYSTEM_ROLE}\n${SKILL_CONTENT}\n\n${RESOURCE_TREE}\nAlready active: github`,
            pluginState: {
              activatedSkills: [{ name: 'PowerShell' }],
              activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
              alreadyActive: ['github'],
            },
          }),
        ]),
      );

      const content = result.messages[0].content as string;
      expect(content).not.toContain(SKILL_CONTENT);
      expect(content).toContain(RESOURCE_TREE);
      expect(content).toContain('Already active: github.');
    });

    it('should NOT trim when a fallback skill copy cannot be located in the blob', async () => {
      // If the blob's copy diverges from the injected content we cannot prove
      // what extra information it carries — keep the full result.
      const processor = new ActivationResultTrimProcessor({
        injectedManifests: [credsManifest],
        injectedSkills: [powershellSkill],
      });
      const original = activateToolsMessage({
        content: `Successfully activated tools:\n\n## Creds (lobe-creds)\n${CREDS_SYSTEM_ROLE}\nstale powershell content v1`,
        pluginState: {
          activatedSkills: [{ name: 'PowerShell' }],
          activatedTools: [{ apiCount: 2, identifier: 'lobe-creds', name: 'Creds' }],
        },
      });
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });

    it('should be byte-identical on results the activator already returns short', async () => {
      // ActivatorExecutionRuntime now emits this exact confirmation at the
      // source; the trim rebuilding the same bytes keeps history stable and
      // guards the two formats against drifting apart.
      const short = [
        'Successfully activated tools: lobe-creds.listCreds, lobe-creds.createCred.',
        'Usage instructions for the activated items are in the system prompt.',
      ].join('\n');
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [credsManifest] });
      const result = await processor.process(
        createContext([activateToolsMessage({ content: short })]),
      );

      expect(result.messages[0].content).toBe(short);
    });

    it('should leave pure already-active results untouched', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedManifests: [credsManifest] });
      const original = activateToolsMessage({
        content: 'Already active: lobe-creds',
        pluginState: { activatedTools: [], alreadyActive: ['lobe-creds'] },
      });
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });
  });

  describe('activateSkill results', () => {
    it('should trim the result and keep the non-injected suffix (resource tree)', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedSkills: [powershellSkill] });
      const result = await processor.process(createContext([activateSkillMessage()]));

      const content = result.messages[0].content as string;
      expect(content).not.toContain(SKILL_CONTENT);
      expect(content).toContain('Skill "PowerShell" activated');
      expect(content).toContain(RESOURCE_TREE);
    });

    it('should match skills case-insensitively by name', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedSkills: [powershellSkill] });
      const result = await processor.process(
        createContext([
          activateSkillMessage({ pluginState: { name: 'powershell', source: 'builtin' } }),
        ]),
      );

      expect(result.messages[0].content).not.toContain(SKILL_CONTENT);
    });

    it('should fully replace a stale result whose content no longer matches', async () => {
      // The skill was edited after activation — the system prompt carries the
      // current version, so the stale copy is dropped entirely.
      const processor = new ActivationResultTrimProcessor({ injectedSkills: [powershellSkill] });
      const result = await processor.process(
        createContext([activateSkillMessage({ content: 'old skill body v1' })]),
      );

      expect(result.messages[0].content).toBe(
        'Skill "PowerShell" activated. Its full instructions are available in the system prompt.',
      );
    });

    it('should NOT trim a dynamically activated skill that is not injected', async () => {
      const processor = new ActivationResultTrimProcessor({
        injectedSkills: [{ ...powershellSkill, activated: false }].filter((s) => s.activated),
      });
      const original = activateSkillMessage();
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });

    it('should handle activator-issued activateSkill results', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedSkills: [powershellSkill] });
      const result = await processor.process(
        createContext([
          activateSkillMessage({
            plugin: { apiName: 'activateSkill', identifier: 'lobe-activator' },
          }),
        ]),
      );

      expect(result.messages[0].content).not.toContain(SKILL_CONTENT);
    });
  });

  describe('safety', () => {
    it('should ignore non-tool messages and other tool results', async () => {
      const processor = new ActivationResultTrimProcessor({
        injectedManifests: [credsManifest],
        injectedSkills: [powershellSkill],
      });
      const messages = [
        { content: SKILL_CONTENT, id: 'u1', role: 'user' },
        {
          content: 'some other tool output',
          id: 't1',
          plugin: { apiName: 'listCreds', identifier: 'lobe-creds' },
          role: 'tool',
        },
      ];
      const result = await processor.process(createContext(messages));

      expect(result.messages[0].content).toBe(SKILL_CONTENT);
      expect(result.messages[1].content).toBe('some other tool output');
    });

    it('should skip non-string tool content', async () => {
      const processor = new ActivationResultTrimProcessor({ injectedSkills: [powershellSkill] });
      const original = activateSkillMessage({ content: [{ text: 'part', type: 'text' }] });
      const result = await processor.process(createContext([original]));

      expect(result.messages[0].content).toBe(original.content);
    });

    it('should skip trimming entirely when a system-replace document discarded the system prompt', async () => {
      const processor = new ActivationResultTrimProcessor({
        injectedManifests: [credsManifest],
        injectedSkills: [powershellSkill],
      });
      const original = activateToolsMessage();
      const context = createContext([original, activateSkillMessage()]);
      context.metadata.agentDocumentSystemReplace = { replaced: true };

      const result = await processor.process(context);

      expect(result.messages[0].content).toBe(original.content);
      expect(result.messages[1].content).toContain(SKILL_CONTENT);
      expect(result.metadata.activationResultTrim).toBeUndefined();
    });

    it('should be a no-op when nothing is injected', async () => {
      const processor = new ActivationResultTrimProcessor({});
      const original = activateToolsMessage();
      const result = await processor.process(createContext([original]));

      expect(result.messages[0]).toBe(original);
      expect(result.metadata.activationResultTrim).toBeUndefined();
    });
  });
});
