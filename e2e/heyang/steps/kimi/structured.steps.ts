import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { chat } from './client';

const requestJson = async (content: string) =>
  chat({
    messages: [{ content, role: 'user' }],
    response_format: { type: 'json_object' },
  });

When('请求 Kimi 返回 JSON 对象', async function () {
  this.kimi = await requestJson('只返回 JSON：{"status":"ok","count":1}');
});

When('请求 Kimi 返回带数组字段的 JSON', async function () {
  this.kimi = await requestJson('只返回 JSON，对象里包含 items 数组，数组元素是 alpha 和 beta。');
});

When('请求 Kimi 返回中文键 JSON', async function () {
  this.kimi = await requestJson('只返回 JSON，包含中文键 “结论”，值为 “通过”。');
});

Then('Kimi 返回合法 JSON', function () {
  const parsed = JSON.parse(this.kimi?.content ?? '');
  expect(typeof parsed).toBe('object');
  expect(parsed).not.toBeNull();
});
