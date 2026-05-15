import fs from 'node:fs';
import path from 'node:path';

import { applyKimiCompat } from '../../../../packages/business/heyang/src/kimi-compat';
import { ToolsEngine } from '../../../../packages/context-engine/src/engine/tools/ToolsEngine';
import type {
  LobeToolManifest,
  UniformTool,
} from '../../../../packages/context-engine/src/engine/tools/types';

type ChatPayload = Record<string, any> & {
  messages: Array<Record<string, any>>;
  model: string;
  provider?: string;
  stream?: boolean;
  tools?: UniformTool[];
};

export interface KimiResponse {
  content: string;
  json: any;
  payload: ChatPayload;
  text: string;
}

export interface ToolRoundtripResult {
  finalContent: string;
  payloads: ChatPayload[];
  texts: string[];
}

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const fixturesRoot = path.resolve(repoRoot, 'e2e', 'heyang', 'fixtures', 'kimi');

const parseEnvFile = (file: string) => {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const key = line.slice(0, line.indexOf('=')).trim();
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replaceAll(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};

let envLoaded = false;

export const loadKimiEnv = () => {
  if (envLoaded) return;
  parseEnvFile(path.resolve(repoRoot, '.env.e2e'));
  parseEnvFile(path.resolve(repoRoot, '.env'));
  envLoaded = true;
};

export const getKimiConfig = () => {
  loadKimiEnv();

  const rawBaseUrl = process.env.HEYANG_KIMI_BASE_URL || process.env.NEWAPI_PROXY_URL;
  const apiKey = process.env.HEYANG_KIMI_API_KEY || process.env.NEWAPI_API_KEY;
  const model = process.env.HEYANG_KIMI_MODEL || 'kimi-k2.6';

  if (!rawBaseUrl) {
    throw new Error('Missing HEYANG_KIMI_BASE_URL or NEWAPI_PROXY_URL for @real-llm tests.');
  }
  if (!apiKey || apiKey.includes('your-test-key')) {
    throw new Error('Missing HEYANG_KIMI_API_KEY or NEWAPI_API_KEY for @real-llm tests.');
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '').endsWith('/v1')
    ? rawBaseUrl.replace(/\/$/, '')
    : `${rawBaseUrl.replace(/\/$/, '')}/v1`;

  return { apiKey, baseUrl, model };
};

const sanitizeBody = (body: string) => body.replaceAll(/sk-[\w-]+/g, 'sk-***').slice(0, 2000);

export const makePayload = (
  payload: Partial<ChatPayload> & { messages: ChatPayload['messages'] },
) => {
  const { model } = getKimiConfig();
  const temperature = Number(process.env.HEYANG_KIMI_TEMPERATURE || 1);

  return applyKimiCompat(
    {
      max_tokens: 512,
      model,
      provider: 'newapi',
      temperature,
      ...payload,
    },
    'newapi',
  );
};

export const chat = async (
  payload: Partial<ChatPayload> & { messages: ChatPayload['messages'] },
): Promise<KimiResponse> => {
  const config = getKimiConfig();
  const finalPayload = makePayload(payload);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.HEYANG_KIMI_TIMEOUT_MS || 60_000),
  );

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify(finalPayload),
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Kimi request failed ${response.status}: ${sanitizeBody(text)}`);
    }

    const json = JSON.parse(text);
    const message = json.choices?.[0]?.message ?? {};
    const content = message.content || message.reasoning_content || '';
    return { content, json, payload: finalPayload, text };
  } finally {
    clearTimeout(timeout);
  }
};

export const streamChat = async (
  payload: Partial<ChatPayload> & { messages: ChatPayload['messages'] },
) => {
  const config = getKimiConfig();
  const finalPayload = makePayload({ ...payload, stream: true });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.HEYANG_KIMI_TIMEOUT_MS || 60_000),
  );
  const chunks: string[] = [];

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify(finalPayload),
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Kimi stream failed ${response.status}: ${sanitizeBody(await response.text())}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) chunks.push(line);
      }
    }

    return { chunks, payload: finalPayload };
  } finally {
    clearTimeout(timeout);
  }
};

export const longContext = (sentinel: string, position: 'start' | 'end' | 'none') => {
  const block =
    '企业知识库兼容性压测段落：本段用于构造长上下文，包含流程、审计、工具调用、文件隔离、权限控制与模型兼容说明。';
  const body = Array.from({ length: 360 }, (_, index) => `${index + 1}. ${block}`).join('\n');
  if (position === 'start') return `${sentinel}\n${body}`;
  if (position === 'end') return `${body}\n${sentinel}`;
  return body;
};

export const loadManifest = (name: string): LobeToolManifest =>
  JSON.parse(fs.readFileSync(path.join(fixturesRoot, name), 'utf8'));

export const toolsFromManifest = (manifest: LobeToolManifest) => {
  const engine = new ToolsEngine({
    manifestSchemas: [manifest],
  });

  return (
    engine.generateTools({
      model: getKimiConfig().model,
      provider: 'newapi',
      skipDefaultTools: true,
      toolIds: [manifest.identifier],
    }) ?? []
  );
};

export const runToolRoundtrip = async (params: {
  firstToolResult?: string;
  messages: ChatPayload['messages'];
  secondTool?: UniformTool;
  secondToolResult?: string;
  tools: UniformTool[];
}): Promise<ToolRoundtripResult> => {
  const payloads: ChatPayload[] = [];
  const texts: string[] = [];

  const completeWithTools = async (messages: ChatPayload['messages']) => {
    let currentMessages = messages;
    let finalResponse = await chat({
      max_tokens: 512,
      messages: currentMessages,
      thinking: { type: 'enabled' },
      tools: params.tools,
    });
    payloads.push(finalResponse.payload);
    texts.push(finalResponse.text);

    for (let index = 0; index < 3; index += 1) {
      const message = finalResponse.json.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      if (finalResponse.content?.trim() || toolCalls.length === 0) return finalResponse.content;

      currentMessages = [
        ...currentMessages,
        message,
        ...toolCalls.map((call: any) => ({
          content: '{"result":"auto test tool result"}',
          role: 'tool',
          tool_call_id: call.id,
        })),
      ];

      finalResponse = await chat({
        max_tokens: 512,
        messages: currentMessages,
        thinking: { type: 'enabled' },
        tools: params.tools,
      });
      payloads.push(finalResponse.payload);
      texts.push(finalResponse.text);
    }

    return finalResponse.content;
  };

  const first = await chat({
    max_tokens: 256,
    messages: params.messages,
    thinking: { type: 'enabled' },
    tool_choice: 'auto',
    tools: params.tools,
  });
  payloads.push(first.payload);
  texts.push(first.text);

  const firstMessage = first.json.choices?.[0]?.message;
  const firstCall = firstMessage?.tool_calls?.[0];
  if (!firstCall) throw new Error('Kimi did not return the expected first tool call.');

  const firstToolResult =
    params.firstToolResult || '{"result":"search result: Hengyang weather is clear."}';
  const afterFirst = [
    ...params.messages,
    firstMessage,
    { content: firstToolResult, role: 'tool', tool_call_id: firstCall.id },
  ];

  if (params.secondTool) {
    const second = await chat({
      max_tokens: 256,
      messages: [
        ...afterFirst,
        {
          content: `现在必须调用 ${params.secondTool.function.name} 工具处理上一步结果，不要直接回答。`,
          role: 'user',
        },
      ],
      thinking: { type: 'enabled' },
      tool_choice: 'auto',
      tools: params.tools,
    });
    payloads.push(second.payload);
    texts.push(second.text);

    const secondMessage = second.json.choices?.[0]?.message;
    const secondCall = secondMessage?.tool_calls?.[0];
    if (!secondCall) throw new Error('Kimi did not return the expected second tool call.');

    const finalContent = await completeWithTools([
      ...afterFirst,
      secondMessage,
      {
        content: params.secondToolResult || '{"stdout":"tool chain finished"}',
        role: 'tool',
        tool_call_id: secondCall.id,
      },
    ]);
    return { finalContent, payloads, texts };
  }

  const finalContent = await completeWithTools(afterFirst);
  return { finalContent, payloads, texts };
};

export const defaultTools: UniformTool[] = [
  {
    function: {
      description: 'Search internal approved public information.',
      name: 'web_search',
      parameters: {
        properties: { query: { type: 'string' } },
        required: ['query'],
        type: 'object',
      },
    },
    type: 'function',
  },
  {
    function: {
      description: 'Run a small deterministic sandbox command.',
      name: 'sandbox_run',
      parameters: {
        properties: { code: { type: 'string' } },
        required: ['code'],
        type: 'object',
      },
    },
    type: 'function',
  },
];
