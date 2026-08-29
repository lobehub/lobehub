import { WEB_ONBOARDING } from '@lobechat/builtin-agents';
import {
  BrowserApiName,
  BrowserIdentifier,
  BrowserInspectors,
  BrowserRenders,
} from '@lobechat/builtin-tool-browser/client';
import {
  ClaudeCodeIdentifier as ClaudeCodeToolIdentifier,
  ClaudeCodeInspectors,
  ClaudeCodeInterventions,
  ClaudeCodeRenders,
  ClaudeCodeStreamings,
} from '@lobechat/builtin-tool-claude-code/client';
import {
  GroupAgentBuilderApiName,
  GroupAgentBuilderIdentifier,
} from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderInspectors } from '@lobechat/builtin-tool-group-agent-builder/client';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import {
  LocalSystemApiName,
  LocalSystemRenders,
  LocalSystemStreamings,
} from '@lobechat/builtin-tool-local-system/client';
import { RemoteDeviceApiName, RemoteDeviceIdentifier } from '@lobechat/builtin-tool-remote-device';
import { SkillStoreApiName, SkillStoreIdentifier } from '@lobechat/builtin-tool-skill-store';
import { SkillStoreInspectors, SkillStoreRenders } from '@lobechat/builtin-tool-skill-store/client';
import {
  UserInteractionApiName,
  UserInteractionIdentifier,
} from '@lobechat/builtin-tool-user-interaction';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
  WebOnboardingManifest,
} from '@lobechat/builtin-tool-web-onboarding';
import { getBuiltinRenderDisplayControl } from '@lobechat/builtin-tools/displayControls';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { getBuiltinInspector } from '@lobechat/builtin-tools/inspectors';
import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { registerBuiltinToolSurfaces } from '@lobechat/builtin-tools/register';
import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { beforeAll, describe, expect, it } from 'vitest';

describe('builtin tool registry', () => {
  beforeAll(() => {
    registerBuiltinToolSurfaces();
  });

  it('includes skill store in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(SkillStoreIdentifier);
  });

  it('includes web onboarding in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(WebOnboardingIdentifier);
  });

  it('registers skill store inspectors and renders for market flows', () => {
    expect(SkillStoreInspectors[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreInspectors[SkillStoreApiName.searchSkill]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.searchSkill]).toBeDefined();
  });

  it('registers group agent builder createGroup inspector', () => {
    expect(builtinToolIdentifiers).toContain(GroupAgentBuilderIdentifier);
    expect(GroupAgentBuilderInspectors[GroupAgentBuilderApiName.createGroup]).toBeDefined();
  });

  it('registers shared Linear MCP surfaces for Claude Code server variants', () => {
    const apiName = 'mcp__linear-server__save_issue';

    expect(getBuiltinInspector(ClaudeCodeToolIdentifier, apiName)).toBeDefined();
    expect(getBuiltinRender(ClaudeCodeToolIdentifier, apiName)).toBeDefined();
    expect(getBuiltinRenderDisplayControl(ClaudeCodeToolIdentifier, apiName)).toBe('expand');
  });

  it('registers Claude-compatible surfaces for Qoder', () => {
    for (const [apiName, render] of Object.entries(ClaudeCodeRenders)) {
      expect(getBuiltinRender('qoder', apiName)).toBe(render);
    }
    for (const [apiName, inspector] of Object.entries(ClaudeCodeInspectors)) {
      expect(getBuiltinInspector('qoder', apiName)).toBe(inspector);
    }
    for (const [apiName, streaming] of Object.entries(ClaudeCodeStreamings)) {
      expect(getBuiltinStreaming('qoder', apiName)).toBe(streaming);
    }
    for (const [apiName, intervention] of Object.entries(ClaudeCodeInterventions)) {
      expect(getBuiltinIntervention('qoder', apiName)).toBe(intervention);
    }
  });

  it('registers the Codex error inspector', () => {
    expect(getBuiltinInspector('codex', 'error')).toBeDefined();
  });

  it('registers inspectors and renders for every in-app browser API', () => {
    for (const apiName of Object.values(BrowserApiName)) {
      expect(BrowserInspectors[apiName]).toBeDefined();
      expect(BrowserRenders[apiName]).toBeDefined();
      expect(getBuiltinInspector(BrowserIdentifier, apiName)).toBe(BrowserInspectors[apiName]);
      expect(getBuiltinRender(BrowserIdentifier, apiName)).toBe(BrowserRenders[apiName]);
    }
  });

  it.each(['opencode', 'pi'])('registers shared file and shell surfaces for %s', (identifier) => {
    for (const apiName of ['bash', 'read', 'write']) {
      expect(getBuiltinInspector(identifier, apiName)).toBeDefined();
      expect(getBuiltinRender(identifier, apiName)).toBeDefined();
    }

    expect(getBuiltinRender(identifier, 'bash')).toBe(
      LocalSystemRenders[LocalSystemApiName.runCommand],
    );
    expect(getBuiltinRender(identifier, 'read')).toBe(
      LocalSystemRenders[LocalSystemApiName.readFile],
    );
    expect(getBuiltinRender(identifier, 'write')).toBe(
      LocalSystemRenders[LocalSystemApiName.writeFile],
    );
    expect(getBuiltinStreaming(identifier, 'bash')).toBe(
      LocalSystemStreamings[LocalSystemApiName.runCommand],
    );
    expect(getBuiltinStreaming(identifier, 'write')).toBe(
      LocalSystemStreamings[LocalSystemApiName.writeFile],
    );
  });

  it('registers remote device inspectors and renders', () => {
    for (const apiName of Object.values(RemoteDeviceApiName)) {
      expect(getBuiltinInspector(RemoteDeviceIdentifier, apiName)).toBeDefined();
      expect(getBuiltinRender(RemoteDeviceIdentifier, apiName)).toBeDefined();
    }
  });

  it('includes user interaction and web onboarding in web onboarding runtime plugins', () => {
    const runtime =
      typeof WEB_ONBOARDING.runtime === 'function'
        ? WEB_ONBOARDING.runtime({ userLocale: 'en-US' })
        : WEB_ONBOARDING.runtime;

    expect(runtime.plugins).toContain(UserInteractionIdentifier);
    expect(runtime.plugins).toContain(WebOnboardingIdentifier);
    expect(runtime.agencyConfig?.executionTarget).toBe('none');
  });

  it('registers the ask user question surfaces across builtin producers', () => {
    expect(
      getBuiltinInspector(UserInteractionIdentifier, UserInteractionApiName.askUserQuestion),
    ).toBeDefined();
    expect(
      getBuiltinRender(UserInteractionIdentifier, UserInteractionApiName.askUserQuestion),
    ).toBeDefined();
    expect(
      getBuiltinInspector(LobeAgentIdentifier, LobeAgentApiName.askUserQuestion),
    ).toBeDefined();
    expect(getBuiltinRender(LobeAgentIdentifier, LobeAgentApiName.askUserQuestion)).toBeDefined();
    expect(
      getBuiltinRender(ClaudeCodeToolIdentifier, UserInteractionApiName.askUserQuestion),
    ).toBeDefined();
    expect(getBuiltinIntervention('qoder', UserInteractionApiName.askUserQuestion)).toBeDefined();
  });

  it('exposes the marketplace APIs under the web onboarding manifest', () => {
    const apiNames = WebOnboardingManifest.api.map((entry) => entry.name);
    expect(apiNames).toContain(WebOnboardingApiName.showAgentMarketplace);
    expect(apiNames).toContain(WebOnboardingApiName.submitAgentPick);
  });
});
