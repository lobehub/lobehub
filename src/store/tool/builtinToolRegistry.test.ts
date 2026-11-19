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
  LocalSystemIdentifier,
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
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ToolInspector from '@/features/Conversation/Messages/AssistantGroup/Tool/Inspector';

describe('builtin tool registry', () => {
  afterEach(cleanup);

  beforeAll(() => {
    registerBuiltinToolSurfaces();
  });

  it('includes skill store in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(SkillStoreIdentifier);
  });

  it('includes web onboarding in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(WebOnboardingIdentifier);
  });

  it('distinguishes reading an image from reading a text file', () => {
    const Inspector = getBuiltinInspector(LocalSystemIdentifier, LocalSystemApiName.readFile)!;
    const base = { apiName: LocalSystemApiName.readFile, identifier: LocalSystemIdentifier };
    const view = render(
      createElement(Inspector, {
        ...base,
        args: {},
        partialArgs: { path: '/tmp/capture.PNG' },
        isArgumentsStreaming: true,
      }),
    );
    expect(view.getByText('builtins.lobe-local-system.inspector.viewImage.loading:')).toBeVisible();
    view.rerender(
      createElement(Inspector, {
        ...base,
        args: { path: '/tmp/capture' },
        pluginState: { images: [{ mediaType: 'image/png', url: 'https://example.test/capture' }] },
      }),
    );
    expect(view.getByText('builtins.lobe-local-system.inspector.viewImage:')).toBeVisible();
    view.rerender(
      createElement(Inspector, {
        ...base,
        args: { path: '/tmp/notes.md' },
      }),
    );
    expect(view.getByText('builtins.lobe-local-system.apiName.readLocalFile:')).toBeVisible();
  });

  it('keeps the image-reading label in collapsed chat rows', () => {
    const view = render(
      createElement(ToolInspector, {
        apiName: LocalSystemApiName.readFile,
        arguments: JSON.stringify({ path: '/tmp/capture.png' }),
        identifier: LocalSystemIdentifier,
        isExpanded: false,
        isToolCalling: true,
        messageId: 'message-image',
        toolCallId: 'read-image',
      }),
    );
    expect(view.getByText('builtins.lobe-local-system.inspector.viewImage.loading:')).toBeVisible();
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
    expect(getBuiltinInspector('droid', UserInteractionApiName.askUserQuestion)).toBeDefined();
    expect(getBuiltinRender('droid', UserInteractionApiName.askUserQuestion)).toBeDefined();
    expect(getBuiltinIntervention('droid', UserInteractionApiName.askUserQuestion)).toBeDefined();
    expect(getBuiltinRender('droid', 'Read')).toBeUndefined();
    expect(getBuiltinInspector('devin', UserInteractionApiName.askUserQuestion)).toBeDefined();
    expect(getBuiltinRender('devin', UserInteractionApiName.askUserQuestion)).toBeDefined();
    expect(getBuiltinIntervention('devin', UserInteractionApiName.askUserQuestion)).toBe(
      ClaudeCodeInterventions[UserInteractionApiName.askUserQuestion],
    );
    expect(getBuiltinIntervention('qoder', UserInteractionApiName.askUserQuestion)).toBeDefined();
  });

  it('registers command and local-file surfaces for Devin ACP tool names', () => {
    // Devin tool calls arrive under the CLI's inference names
    // (`_meta['cognition.ai/inferenceToolName']`), not Claude Code's.
    expect(getBuiltinInspector('devin', 'exec')).toBeDefined();
    expect(getBuiltinRender('devin', 'exec')).toBeDefined();
    expect(getBuiltinInspector('devin', 'read')).toBeDefined();
    expect(getBuiltinRender('devin', 'read')).toBeDefined();
    expect(getBuiltinInspector('devin', 'write')).toBeDefined();
    expect(getBuiltinRender('devin', 'write')).toBeDefined();
    expect(getBuiltinInspector('devin', 'edit')).toBeDefined();
    // No diffText is synthesized for ACP updates, so edit keeps the generic
    // result view instead of an empty patch card.
    expect(getBuiltinRender('devin', 'edit')).toBeUndefined();
  });

  it('exposes the marketplace APIs under the web onboarding manifest', () => {
    const apiNames = WebOnboardingManifest.api.map((entry) => entry.name);
    expect(apiNames).toContain(WebOnboardingApiName.showAgentMarketplace);
    expect(apiNames).toContain(WebOnboardingApiName.submitAgentPick);
  });
});
