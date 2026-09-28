import { WEB_ONBOARDING } from '@lobechat/builtin-agents';
import { AuvApiName, AuvIdentifier, AuvManifest } from '@lobechat/builtin-tool-auv/client';
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
import { alwaysOnToolIds } from '@lobechat/builtin-tools';
import { getBuiltinRenderDisplayControl } from '@lobechat/builtin-tools/displayControls';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { getBuiltinInspector } from '@lobechat/builtin-tools/inspectors';
import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { registerBuiltinToolSurfaces } from '@lobechat/builtin-tools/register';
import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
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

  it('includes AUV in builtin identifiers', () => {
    expect(AuvIdentifier).toBe('lobe-computer-use');
    expect(AuvManifest.meta.title).toBe('Computer Use');
    expect(AuvManifest.api[0].parameters.properties).toHaveProperty('reasoning');
    expect(AuvManifest.api[0].parameters.required).toEqual(['argv']);
    expect(builtinToolIdentifiers).toContain(AuvIdentifier);
  });

  /** @example AUV command calls resolve a custom header instead of the generic API label. */
  it('registers an inspector for the AUV CLI entry point', () => {
    // ROOT CAUSE:
    //
    // AUV was registered as a builtin without a matching inspector registration.
    // The chat therefore fell back to the API name and hid the command being invoked.
    // Registering the AUV inspector makes command context available in every lifecycle phase.
    /** @example lobe-computer-use/runCommand resolves a component in the central registry. */
    expect(getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand)).toBeDefined();
  });

  /** @example A command with a spaced argument stays readable after execution. */
  it('renders AUV argv through its registered inspector without losing argument boundaries', () => {
    const Inspector = getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand);
    if (!Inspector) throw new Error('AUV inspector is not registered');

    const view = render(
      createElement(Inspector, {
        apiName: AuvApiName.runCommand,
        args: { argv: ['invoke', 'input.typeText', 'hello world', ''] },
        identifier: AuvIdentifier,
        pluginState: { output: { ok: true } },
      }),
    );

    /** @example A single "hello world" argument and an empty argument remain distinguishable. */
    expect(view.getByText('auv invoke input.typeText "hello world" ""')).toBeVisible();
    /** @example AUV uses a localized command label instead of the raw runCommand API name. */
    expect(view.getByText('builtins.lobe-computer-use.inspector.input:')).toBeVisible();
  });

  /** @example Streaming begins with a label and progressively reveals the AUV command. */
  it('keeps the AUV header visible while arguments stream and execution loads', () => {
    const Inspector = getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand);
    if (!Inspector) throw new Error('AUV inspector is not registered');

    const baseProps = { apiName: AuvApiName.runCommand, args: {}, identifier: AuvIdentifier };
    const view = render(createElement(Inspector, { ...baseProps, isArgumentsStreaming: true }));
    /** @example The empty streaming phase pulses a non-empty localized title. */
    expect(view.getByText('builtins.lobe-computer-use.inspector.operate.loading')).toHaveClass(
      shinyTextStyles.shinyText,
    );

    view.rerender(
      createElement(Inspector, {
        ...baseProps,
        isArgumentsStreaming: true,
        partialArgs: { argv: ['invoke', 'display.'] },
      }),
    );
    /** @example Partial argv is displayed before final arguments are available. */
    expect(view.getByText('auv invoke display.')).toBeVisible();

    view.rerender(
      createElement(Inspector, {
        ...baseProps,
        args: { argv: ['invoke', 'display.list'] },
        isLoading: true,
        partialArgs: { argv: ['invoke', 'display.'] },
      }),
    );
    /** @example Completed arguments supersede the partial command during execution. */
    expect(view.getByText('auv invoke display.list')).toBeVisible();
    /** @example Execution keeps the shared loading animation. */
    expect(view.getByText('builtins.lobe-computer-use.inspector.inspect.loading:')).toHaveClass(
      shinyTextStyles.shinyText,
    );
  });

  /** @example Failed calls retain their command context even without pluginState. */
  it('renders failed AUV calls without requiring a successful result payload', () => {
    const Inspector = getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand);
    if (!Inspector) throw new Error('AUV inspector is not registered');

    const view = render(
      createElement(Inspector, {
        apiName: AuvApiName.runCommand,
        args: { argv: ['invoke', 'display.capture'] },
        identifier: AuvIdentifier,
        result: { content: null, error: { message: 'Screen recording permission denied' } },
      }),
    );
    /** @example The failed command is still identifiable in conversation history. */
    expect(view.getByText('auv invoke display.capture')).toBeVisible();
    /** @example A finished failure does not keep pulsing as if it were running. */
    expect(view.getByText('builtins.lobe-computer-use.inspector.capture:')).not.toHaveClass(
      shinyTextStyles.shinyText,
    );
  });

  // PR #19051: one CLI entry point must still describe the actual computer action.
  it.each([
    ['input.clickPoint', 'operate'],
    ['input.typeText', 'input'],
    ['input.pasteText', 'input'],
    ['input.key', 'keyboard'],
    ['input.keyboard', 'keyboard'],
    ['input.focusText', 'focus'],
    ['display.capture', 'capture'],
    ['window.capture', 'capture'],
    ['screen.captureRegion', 'capture'],
    ['window.list', 'inspect'],
    ['future.command', 'operate'],
  ])('describes %s while it executes', (command, activity) => {
    const Inspector = getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand)!;
    const view = render(
      createElement(Inspector, {
        apiName: AuvApiName.runCommand,
        args: { argv: ['invoke', command], reasoning: 'Find the search field' },
        identifier: AuvIdentifier,
        isLoading: true,
      }),
    );
    expect(
      view.getByText(`builtins.lobe-computer-use.inspector.${activity}.loading:`),
    ).toBeVisible();
    expect(view.getByText('Find the search field')).toBeVisible();
    expect(view.queryByText(`auv invoke ${command}`)).toBeNull();
  });

  it('keeps streamed reasoning and uses help or dry-run labels before action labels', () => {
    const Inspector = getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand)!;
    const base = { apiName: AuvApiName.runCommand, identifier: AuvIdentifier, args: {} };
    const view = render(
      createElement(Inspector, {
        ...base,
        isArgumentsStreaming: true,
        partialArgs: {
          argv: ['invoke', 'display.capture', '--help'],
          reasoning: 'Check capture options',
        },
      }),
    );
    expect(view.getByText('builtins.lobe-computer-use.inspector.help.loading:')).toBeVisible();
    expect(view.getByText('Check capture options')).toBeVisible();
    view.rerender(
      createElement(Inspector, {
        ...base,
        args: { argv: ['invoke', 'input.typeText', 'hello', '--dry-run'] },
        isLoading: true,
      }),
    );
    expect(view.getByText('builtins.lobe-computer-use.inspector.preview.loading:')).toBeVisible();
    view.rerender(
      createElement(Inspector, {
        ...base,
        args: { argv: ['invoke', 'input.typeText', '--', '--help'] },
        isLoading: true,
      }),
    );
    expect(view.getByText('builtins.lobe-computer-use.inspector.input.loading:')).toBeVisible();
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

  // PR #19051: collapsed chat rows bypassed the registered inspector entirely.
  it('keeps action labels and reasoning in collapsed Computer Use chat rows', () => {
    const view = render(
      createElement(ToolInspector, {
        apiName: AuvApiName.runCommand,
        arguments: JSON.stringify({
          argv: ['invoke', 'display.capture'],
          reasoning: 'Check the search result',
        }),
        identifier: AuvIdentifier,
        isExpanded: false,
        isToolCalling: true,
        toolCallId: 'computer-use-capture',
      }),
    );
    expect(view.getByText('builtins.lobe-computer-use.inspector.capture.loading:')).toBeVisible();
    expect(view.getByText('Check the search result')).toBeVisible();
  });

  it('keeps the image-reading label in collapsed chat rows', () => {
    const view = render(
      createElement(ToolInspector, {
        apiName: LocalSystemApiName.readFile,
        arguments: JSON.stringify({ path: '/tmp/capture.png' }),
        identifier: LocalSystemIdentifier,
        isExpanded: false,
        isToolCalling: true,
        toolCallId: 'computer-use-image',
      }),
    );
    expect(view.getByText('builtins.lobe-local-system.inspector.viewImage.loading:')).toBeVisible();
  });

  it('renders historical AUV calls without advertising the retired identifier', () => {
    expect(getBuiltinInspector('lobe-auv', AuvApiName.runCommand)).toBe(
      getBuiltinInspector(AuvIdentifier, AuvApiName.runCommand),
    );
    expect(builtinToolIdentifiers).not.toContain('lobe-auv');
    const view = render(
      createElement(ToolInspector, {
        apiName: AuvApiName.runCommand,
        arguments: JSON.stringify({ argv: ['invoke', 'input.key', 'return'] }),
        identifier: 'lobe-auv',
        isExpanded: false,
        result: { content: null, error: { message: 'Input failed' } },
        toolCallId: 'historical-auv',
      }),
    );
    expect(view.getByText('builtins.lobe-computer-use.inspector.keyboard:')).toBeVisible();
  });

  it('keeps Computer Use out of the always-on tools', () => {
    expect(alwaysOnToolIds).not.toContain(AuvIdentifier);
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

  it('exposes the marketplace APIs under the web onboarding manifest', () => {
    const apiNames = WebOnboardingManifest.api.map((entry) => entry.name);
    expect(apiNames).toContain(WebOnboardingApiName.showAgentMarketplace);
    expect(apiNames).toContain(WebOnboardingApiName.submitAgentPick);
  });
});
