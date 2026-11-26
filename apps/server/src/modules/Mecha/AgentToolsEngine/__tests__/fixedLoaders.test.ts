// @vitest-environment node
import { getUserDisabledToolIds } from '@lobechat/builtin-tools';
import { expect, it } from 'vitest';

import { createServerAgentToolsEngine } from '../index';

it('preserves fixed loaders despite legacy user preferences, but honors optional tool disables', () => {
  const disabled = ['lobe-skills', 'lobe-activator', 'lobe-skill-store'].map((identifier) => ({
    identifier,
    mode: 'disabled' as const,
  }));
  const engine = createServerAgentToolsEngine(
    { installedPlugins: [], isModelSupportToolUse: () => true },
    {
      agentConfig: { plugins: [] },
      disabledPluginIds: getUserDisabledToolIds(disabled),
      model: 'deepseek-chat',
      provider: 'deepseek',
    },
  );
  const { enabledToolIds } = engine.generateToolsDetailed({
    model: 'deepseek-chat',
    provider: 'deepseek',
    toolIds: [],
  });
  expect(enabledToolIds).toContain('lobe-skills');
  expect(enabledToolIds).toContain('lobe-activator');
  expect(engine.getAvailablePlugins()).not.toContain('lobe-skill-store');
  expect(getUserDisabledToolIds(disabled, { toolMode: 'custom' })).toContain('lobe-skills');
});
