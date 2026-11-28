import { describe, expect, it } from 'vitest';

import enChat from '../../../../locales/en-US/chat.json';
import enError from '../../../../locales/en-US/error.json';
import enModelProvider from '../../../../locales/en-US/modelProvider.json';
import enPlugin from '../../../../locales/en-US/plugin.json';
import enSetting from '../../../../locales/en-US/setting.json';
import zhChat from '../../../../locales/zh-CN/chat.json';
import zhError from '../../../../locales/zh-CN/error.json';
import zhModelProvider from '../../../../locales/zh-CN/modelProvider.json';
import zhPlugin from '../../../../locales/zh-CN/plugin.json';
import zhSetting from '../../../../locales/zh-CN/setting.json';
import chat from './chat';
import error from './error';
import modelProvider from './modelProvider';
import plugin from './plugin';
import setting from './setting';

type Resource = Record<string, string>;

const namespaces: Record<string, { default: Resource; en: Resource; zh: Resource }> = {
  chat: { default: chat, en: enChat, zh: zhChat },
  error: { default: error, en: enError, zh: zhError },
  modelProvider: { default: modelProvider, en: enModelProvider, zh: zhModelProvider },
  plugin: { default: plugin, en: enPlugin, zh: zhPlugin },
  setting: { default: setting, en: enSetting, zh: zhSetting },
};

// "Skill" names Agent Skills (SKILL.md) only. Calling a function is a tool call,
// and an MCP server or plugin that provides tools is a connector.
const toolKeys = [
  'chat:task.metrics.toolCallsShort',
  'chat:task.activity.calling',
  'chat:task.activity.gotResult',
  'chat:tool.intervention.rejectedWithReason',
  'chat:tool.intervention.toolAbort',
  'chat:tool.intervention.toolRejected',
  'chat:toolAuth.title',
  'chat:toolAuth.hint',
  'error:response.PluginApiParamsError',
  'error:response.PluginFailToTransformArguments',
  'modelProvider:providerModels.item.modelConfig.functionCall.title',
  'plugin:debug.tool_call',
  'plugin:inspector.orphanedToolCall',
  'plugin:loading.content',
  'setting:llm.customModelCards.modelConfig.functionCall.title',
];

const connectorKeys = [
  'error:response.PluginManifestNotFound',
  'plugin:builtins.lobe-agent-builder.apiName.installPlugin',
  'plugin:mcpInstall.INSTALLING_PLUGIN',
  'plugin:protocolInstall.custom.title',
  'setting:settingAgent.tools.type.plugin',
  'setting:tab.addCustomMcp',
];

const resolve = (id: string) => {
  const [ns, key] = id.split(/:(.*)/s);
  const resources = namespaces[ns];
  return { default: resources.default[key], en: resources.en[key], zh: resources.zh[key] };
};

describe('tool and connector terminology', () => {
  it.each(toolKeys)('calls %s a tool, not a skill', (id) => {
    const copy = resolve(id);

    expect(copy.en).toBe(copy.default);
    expect(copy.default).not.toMatch(/skill/i);
    expect(copy.zh).not.toContain('技能');
    expect(copy.zh).toContain('工具');
  });

  it.each(connectorKeys)('calls %s a connector, not a skill', (id) => {
    const copy = resolve(id);

    expect(copy.en).toBe(copy.default);
    expect(copy.default).not.toMatch(/skill/i);
    expect(copy.default).toMatch(/connector/i);
    expect(copy.zh).not.toContain('技能');
    expect(copy.zh).toContain('连接器');
  });
});
