import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { chat, defaultTools, loadManifest, runToolRoundtrip, toolsFromManifest } from './client';

const baseMessages = [
  {
    content: '你必须先调用可用工具，再根据 tool 结果给出一句中文最终答复。不要自行编造工具结果。',
    role: 'system',
  },
  { content: '请搜索衡阳天气并给出摘要。', role: 'user' },
];

When('Kimi 执行单工具调用回合', async function () {
  this.kimi = await runToolRoundtrip({
    messages: baseMessages,
    tools: defaultTools,
  });
});

When('Kimi 执行搜索加沙箱多工具串联', async function () {
  this.kimi = await runToolRoundtrip({
    messages: [
      ...baseMessages,
      { content: '搜索后再调用 sandbox_run 处理结果长度。', role: 'user' },
    ],
    secondTool: defaultTools[1],
    tools: defaultTools,
  });
});

When('Kimi 遇到工具错误并继续回复', async function () {
  this.kimi = await runToolRoundtrip({
    firstToolResult:
      '{"error":"search provider unavailable","fallback":"请基于已知信息说明无法实时查询"}',
    messages: baseMessages,
    tools: defaultTools,
  });
});

When('Kimi 执行带 thinking 的工具回填请求', async function () {
  this.kimi = await runToolRoundtrip({
    messages: baseMessages,
    tools: defaultTools,
  });
});

Then('Kimi 工具回合返回最终回复且没有 reasoning_content 错误', function () {
  expect(this.kimi?.finalContent?.trim().length).toBeGreaterThan(0);
  for (const payload of this.kimi?.payloads ?? []) {
    expect(payload).not.toHaveProperty('thinking');
  }
  const joined = (this.kimi?.texts ?? []).join('\n');
  expect(joined).not.toContain('reasoning_content is missing');
  expect(joined).not.toContain('thinking is enabled');
});

Then('Kimi 工具回填请求已移除 thinking 参数', function () {
  for (const payload of this.kimi?.payloads ?? []) {
    expect(payload).not.toHaveProperty('thinking');
  }
});

When('使用重复 api.name 的 MCP manifest 生成工具', function () {
  const manifest = loadManifest('duplicate-mcp-manifest.json');
  const tools = toolsFromManifest(manifest);
  this.kimi = { tools };
});

Then('生成的 Kimi 工具列表没有重复 function name', function () {
  const names = this.kimi.tools.map((tool: any) => tool.function.name);
  expect(new Set(names).size).toBe(names.length);
});

When('使用重复 api.name 的 MCP 工具请求 Kimi', async function () {
  const tools = toolsFromManifest(loadManifest('duplicate-mcp-manifest.json'));
  this.kimi = await runToolRoundtrip({
    messages: [
      {
        content: `你必须先调用 ${tools[0].function.name} 工具，再根据 tool 结果用一句中文回复。`,
        role: 'system',
      },
      { content: '查询市场事件并摘要。', role: 'user' },
    ],
    tools,
  });
});

When('使用无重复 api.name 的 MCP 工具请求 Kimi', async function () {
  const tools = toolsFromManifest(loadManifest('normal-mcp-manifest.json'));
  const response = await chat({
    messages: [
      {
        content: '你可以按需使用工具；如果不用工具，也要用一句中文回复测试通过。',
        role: 'system',
      },
      { content: '查询市场事件并摘要。', role: 'user' },
    ],
    tools,
  });
  this.kimi = {
    finalContent: response.content,
    payloads: [response.payload],
    texts: [response.text],
  };
});

Then('Kimi 工具回合返回最终回复且没有 duplicate 错误', function () {
  expect(this.kimi?.finalContent?.trim().length).toBeGreaterThan(0);
  const joined = (this.kimi?.texts ?? []).join('\n');
  expect(joined).not.toContain('function name');
  expect(joined).not.toContain('duplicated');
  expect(joined).not.toContain('duplicate');
});

When('直接请求 Kimi 使用重复 function name 的工具列表', async function () {
  const duplicateTools = [defaultTools[0], defaultTools[0]];
  this.kimi = await chat({
    messages: baseMessages,
    tools: duplicateTools,
  });
});
