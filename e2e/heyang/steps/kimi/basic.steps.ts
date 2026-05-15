import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { chat, getKimiConfig, longContext, streamChat } from './client';

Given('Kimi 测试配置已加载', function () {
  getKimiConfig();
});

When('发送 Kimi 简单问候', async function () {
  this.kimi = await chat({
    messages: [{ content: '你好，请用一句中文回复。', role: 'user' }],
  });
});

Then('Kimi 返回非空回复', function () {
  expect(this.kimi?.content?.trim().length).toBeGreaterThan(0);
});

When('进行 Kimi 两轮上下文记忆对话', async function () {
  const secret = 'BLUE-RIVER-42';
  const first = await chat({
    messages: [{ content: `请记住测试暗号：${secret}。只回复“已记住”。`, role: 'user' }],
  });
  const second = await chat({
    messages: [
      { content: `请记住测试暗号：${secret}。只回复“已记住”。`, role: 'user' },
      { content: first.content, role: 'assistant' },
      { content: '刚才的测试暗号是什么？只回复暗号。', role: 'user' },
    ],
  });
  this.kimi = { ...second, secret };
});

Then('Kimi 第二轮能引用第一轮暗号', function () {
  expect(this.kimi?.content).toContain(this.kimi.secret);
});

When('请求 Kimi 流式输出', async function () {
  this.kimi = await streamChat({
    messages: [{ content: '请分三小句介绍企业 Agent 门户，每句不超过 12 个字。', role: 'user' }],
  });
});

Then('至少收到 {int} 个 Kimi 流式 chunk', function (count: number) {
  expect(this.kimi?.chunks?.length ?? 0).toBeGreaterThanOrEqual(count);
});

When('发送 Kimi 8K 上下文请求', async function () {
  this.kimi = await chat({
    max_tokens: 128,
    messages: [{ content: `${longContext('', 'none')}\n\n请回复“长上下文已读取”。`, role: 'user' }],
  });
});

When(/^发送包含开头哨兵的 Kimi 8K 上下文请求$/, async function () {
  this.kimi = await chat({
    max_tokens: 128,
    messages: [
      {
        content: `${longContext('START-SENTINEL-42', 'start')}\n\n请找出开头的哨兵字符串，只回复它。`,
        role: 'user',
      },
    ],
  });
});

When(/^发送包含结尾哨兵的 Kimi 8K 上下文请求$/, async function () {
  this.kimi = await chat({
    max_tokens: 128,
    messages: [
      {
        content: `${longContext('END-SENTINEL-84', 'end')}\n\n请找出结尾的哨兵字符串，只回复它。`,
        role: 'user',
      },
    ],
  });
});

Then(/^Kimi 回复包含哨兵 "([^"]+)"$/, function (sentinel: string) {
  expect(this.kimi?.content).toContain(sentinel);
});
