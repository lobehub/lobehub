import { mkdir, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import path from 'node:path';

import { hashPromptRequest, redactHeaders } from './canonical';

interface ToolCall {
  args: Record<string, unknown>;
  id: string;
  name: string;
}

interface NormalizedRequest {
  messages?: Array<{
    content?: unknown;
    role?: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id?: string }>;
  }>;
  model?: string;
  stream?: boolean;
  tools?: Array<{ function?: { name?: string } }>;
}

const captureDir = process.env.PROMPT_HARNESS_CAPTURE_DIR;
const mockPort = Number(process.env.PROMPT_HARNESS_MOCK_PORT);

if (!captureDir || !Number.isInteger(mockPort)) {
  throw new Error('PROMPT_HARNESS_CAPTURE_DIR and PROMPT_HARNESS_MOCK_PORT are required.');
}

await mkdir(captureDir, { recursive: true });
let sequence = 0;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-type': 'application/json',
  });
  res.end(JSON.stringify(body));
};

const textContent = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

const allUserText = (messages: readonly { content?: unknown; role?: string }[]): string =>
  messages
    .filter((message) => message.role === 'user')
    .map((message) => textContent(message.content))
    .join('\n');

const assistantCalls = (
  messages: readonly {
    role?: string;
    tool_calls?: Array<{ id?: string }>;
  }[],
) =>
  messages.flatMap((message) => (message.role === 'assistant' ? (message.tool_calls ?? []) : []));

const hasCall = (
  messages: readonly {
    role?: string;
    tool_calls?: Array<{ id?: string }>;
  }[],
  id: string,
) => assistantCalls(messages).some((call) => call.id === id);

const toolResult = (
  messages: readonly {
    content?: unknown;
    role?: string;
    tool_call_id?: string;
  }[],
  callId: string,
): string =>
  textContent(
    messages.find((message) => message.role === 'tool' && message.tool_call_id === callId)?.content,
  );

const documentContinuation = (content: string): { limit: number; offset: number } => {
  const match = content.match(
    /<document_read_metadata>\s*(\{[\s\S]*?\})\s*<\/document_read_metadata>/,
  );
  if (!match)
    throw new Error(`Document result has no continuation metadata: ${content.slice(0, 500)}`);
  const metadata = JSON.parse(match[1]) as { hasMore?: boolean; nextOffset?: number };
  if (!metadata.hasMore || typeof metadata.nextOffset !== 'number') {
    throw new Error('Document result does not expose a next offset.');
  }
  return { limit: 4000, offset: metadata.nextOffset };
};

const findToolName = (
  request: { tools?: Array<{ function?: { name?: string } }> },
  suffix: string,
) =>
  request.tools
    ?.map((tool) => tool.function?.name)
    .find((name) => typeof name === 'string' && name.endsWith(`____${suffix}`));

const chooseAction = (request: {
  messages?: Array<{
    content?: unknown;
    role?: string;
    tool_calls?: Array<{ id?: string }>;
  }>;
  tools?: Array<{ function?: { name?: string } }>;
}): { content: string } | ToolCall => {
  const messages = request.messages ?? [];
  const prompt = allUserText(messages);

  if (prompt.includes('T106_MANUAL_SKILL')) {
    return { content: 'T106 manual skill capture complete.' };
  }

  if (prompt.includes('T106_INTERVENTION_UI')) {
    const messageTexts = messages.map((message) => textContent(message.content));
    const activationCompleted =
      hasCall(messages, 'call_t106_ui_activate') ||
      messageTexts.some((content) => content.includes('Successfully activated tools: lobe-agent'));

    if (!activationCompleted) {
      const name = findToolName(request, 'activateTools');
      if (!name) throw new Error('activateTools was not present for the intervention scenario.');
      return {
        args: {
          identifiers: ['lobe-agent'],
          reason: 'T106 exercises the native approval UI before loading the tool.',
        },
        id: 'call_t106_ui_activate',
        name,
      };
    }

    const questionCompleted =
      hasCall(messages, 'call_t106_ui_question') ||
      messageTexts.some((content) =>
        content.includes('Use the deterministic option (Recommended)'),
      );

    if (!questionCompleted) {
      const name = findToolName(request, 'askUserQuestion');
      if (!name) throw new Error('askUserQuestion was not present after activation.');
      return {
        args: {
          questions: [
            {
              header: 'T106 UI',
              options: [
                {
                  description: 'Exercises the real custom intervention form.',
                  label: 'Use the deterministic option (Recommended)',
                },
                {
                  description: 'Leaves the run waiting for a different selection.',
                  label: 'Choose another option',
                },
              ],
              question: 'Should T106 continue with the native custom intervention?',
            },
          ],
        },
        id: 'call_t106_ui_question',
        name,
      };
    }

    return { content: 'T106 intervention UI capture complete.' };
  }

  if (prompt.includes('T106_NEGATIVE_ACTIVATION')) {
    const activateName = findToolName(request, 'activateTools');
    if (!activateName) return { content: 'T106 negative activation capture complete.' };

    if (!hasCall(messages, 'call_t106_negative_missing_bundle')) {
      return {
        args: {
          identifiers: ['t106-missing-bundle'],
          reason: 'T106 verifies a missing bundle cannot activate.',
        },
        id: 'call_t106_negative_missing_bundle',
        name: activateName,
      };
    }

    if (!hasCall(messages, 'call_t106_negative_forged_identity')) {
      return {
        args: {
          identifiers: [
            {
              hash: 'md5:t106-forged-hash',
              identifier: 'lobe-calculator',
              version: 't106-forged-version',
            },
          ],
          reason: 'T106 verifies forged version and hash fail closed.',
        },
        id: 'call_t106_negative_forged_identity',
        name: activateName,
      };
    }

    if (!hasCall(messages, 'call_t106_negative_unpermitted_tool')) {
      return {
        args: { expression: '1 + 1' },
        id: 'call_t106_negative_unpermitted_tool',
        name: 'lobe-calculator____calculate',
      };
    }

    return { content: 'T106 negative activation capture complete.' };
  }

  if (prompt.includes('T106_PROTECTED_BUDGET')) {
    if (!hasCall(messages, 'call_t106_protected_activate')) {
      const name = findToolName(request, 'activateTools');
      if (!name) throw new Error('activateTools was not present for protected budget.');
      return {
        args: {
          identifiers: ['lobe-calculator'],
          reason: 'T106 protects the active tool contract while the shared budget is pressured.',
        },
        id: 'call_t106_protected_activate',
        name,
      };
    }

    return { content: 'T106 protected budget capture complete.' };
  }

  if (prompt.includes('T106_SKILL_FLOW')) {
    if (!hasCall(messages, 'call_t106_activate_skill')) {
      return {
        args: { name: 'lobehub' },
        id: 'call_t106_activate_skill',
        name: findToolName(request, 'activateSkill'),
      };
    }

    if (!hasCall(messages, 'call_t106_read_reference')) {
      return {
        args: { id: 'lobehub', path: 'references/agent' },
        id: 'call_t106_read_reference',
        name: findToolName(request, 'readReference'),
      };
    }

    return { content: 'T106 skill flow capture complete.' };
  }

  if (!prompt.includes('T105_TOOL_ACTIVATION') && !prompt.includes('T105_LONG_DOCUMENT')) {
    return { content: 'T105 prompt capture complete.' };
  }

  if (prompt.includes('T105_TOOL_ACTIVATION')) {
    if (!hasCall(messages, 'call_t105_activate_tools')) {
      const name = findToolName(request, 'activateTools');
      if (!name) throw new Error('activateTools was not present in the bootstrap tool set.');
      return {
        args: {
          identifiers: ['lobe-calculator'],
          reason: 'T105 proves that activation preserves the native active tool contract.',
        },
        id: 'call_t105_activate_tools',
        name,
      };
    }
    return { content: 'T105 tool activation capture complete.' };
  }

  if (!hasCall(messages, 'call_t105_read_long_document_1')) {
    const name = findToolName(request, 'readDocument');
    if (!name) throw new Error('readDocument was not present in the bootstrap tool set.');
    return {
      args: {
        format: 'markdown',
        id: 'a1050000-0000-4000-8000-000000000001',
        limit: 4000,
        offset: 0,
      },
      id: 'call_t105_read_long_document_1',
      name,
    };
  }

  if (!hasCall(messages, 'call_t105_read_long_document_2')) {
    const name = findToolName(request, 'readDocument');
    if (!name) throw new Error('readDocument was not present in the bootstrap tool set.');
    return {
      args: {
        format: 'markdown',
        id: 'a1050000-0000-4000-8000-000000000001',
        ...documentContinuation(toolResult(messages, 'call_t105_read_long_document_1')),
      },
      id: 'call_t105_read_long_document_2',
      name,
    };
  }

  return { content: 'T105 long document capture complete.' };
};

const responseContentText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return textContent(content);

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return String(part ?? '');
      const typedPart = part as { text?: unknown };
      return typeof typedPart.text === 'string' ? typedPart.text : '';
    })
    .join('');
};

/**
 * Capture a protocol-neutral view while retaining the exact Responses request
 * in `rawRequest`. The harness assertions can then inspect real messages/tools
 * regardless of which OpenAI wire protocol the product selected.
 */
const normalizeResponsesRequest = (rawRequest: {
  input?: unknown;
  model?: string;
  stream?: boolean;
  tools?: Array<{
    function?: { description?: string; name?: string; parameters?: unknown };
    name?: string;
    parameters?: unknown;
    type?: string;
  }>;
}): NormalizedRequest => {
  const messages: NonNullable<NormalizedRequest['messages']> = [];
  const input =
    typeof rawRequest.input === 'string'
      ? [{ content: rawRequest.input, role: 'user', type: 'message' }]
      : Array.isArray(rawRequest.input)
        ? rawRequest.input
        : [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as {
      arguments?: string;
      call_id?: string;
      content?: unknown;
      name?: string;
      output?: unknown;
      role?: string;
      type?: string;
    };

    if (entry.type === 'function_call') {
      messages.push({
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: entry.arguments ?? '{}',
              name: entry.name,
            },
            id: entry.call_id,
          },
        ] as never,
      });
      continue;
    }

    if (entry.type === 'function_call_output') {
      messages.push({
        content: responseContentText(entry.output),
        role: 'tool',
        tool_call_id: entry.call_id,
      });
      continue;
    }

    if (entry.role) {
      messages.push({ content: responseContentText(entry.content), role: entry.role });
    }
  }

  return {
    messages,
    model: rawRequest.model,
    stream: rawRequest.stream,
    tools: (rawRequest.tools ?? [])
      .filter((tool) => tool.type === 'function')
      .map((tool) => ({
        function: {
          description: tool.description ?? tool.function?.description,
          name: tool.name ?? tool.function?.name,
          parameters: tool.parameters ?? tool.function?.parameters,
        },
      })),
  };
};

const completion = (
  request: { model?: string },
  requestNumber: number,
  action: { content: string } | ToolCall,
) => {
  const base = {
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl-t105-${requestNumber}`,
    model: request.model,
    object: 'chat.completion',
  };

  if ('name' in action) {
    return {
      ...base,
      choices: [
        {
          finish_reason: 'tool_calls',
          index: 0,
          message: {
            content: null,
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify(action.args),
                  name: action.name,
                },
                id: action.id,
                type: 'function',
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: 8, prompt_tokens: 128, total_tokens: 136 },
    };
  }

  return {
    ...base,
    choices: [
      {
        finish_reason: 'stop',
        index: 0,
        message: { content: action.content, role: 'assistant' },
      },
    ],
    usage: { completion_tokens: 8, prompt_tokens: 128, total_tokens: 136 },
  };
};

const sendStream = (res: ServerResponse, response: ReturnType<typeof completion>) => {
  const choice = response.choices[0];
  const delta =
    'tool_calls' in choice.message
      ? {
          role: 'assistant',
          tool_calls: choice.message.tool_calls.map((call, index) => ({ ...call, index })),
        }
      : { content: choice.message.content, role: 'assistant' };
  const base = {
    created: response.created,
    id: response.id,
    model: response.model,
    object: 'chat.completion.chunk',
  };

  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'content-type': 'text/event-stream',
  });
  res.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ delta, finish_reason: null, index: 0 }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ delta: {}, finish_reason: choice.finish_reason, index: 0 }],
      usage: response.usage,
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
};

const sendResponsesStream = (
  res: ServerResponse,
  request: NormalizedRequest,
  responseNumber: number,
  action: { content: string } | ToolCall,
) => {
  const responseId = `resp-t105-${responseNumber}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const model = request.model ?? 'gpt-4o';
  const usage = {
    input_tokens: 128,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 8,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 136,
  };
  const response = {
    created_at: createdAt,
    id: responseId,
    model,
    object: 'response',
    output: [] as unknown[],
    status: 'in_progress',
    usage: null,
  };

  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const emit = (event: Record<string, unknown>) => {
    res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  emit({ response, type: 'response.created' });

  if ('name' in action) {
    const item = {
      arguments: '',
      call_id: action.id,
      id: `fc-t105-${responseNumber}`,
      name: action.name,
      status: 'in_progress',
      type: 'function_call',
    };
    emit({ item, output_index: 0, response_id: responseId, type: 'response.output_item.added' });
    emit({
      delta: JSON.stringify(action.args),
      item_id: item.id,
      output_index: 0,
      response_id: responseId,
      type: 'response.function_call_arguments.delta',
    });
    emit({
      item: { ...item, arguments: JSON.stringify(action.args), status: 'completed' },
      output_index: 0,
      response_id: responseId,
      type: 'response.output_item.done',
    });
  } else {
    const itemId = `msg-t105-${responseNumber}`;
    const item = {
      content: [] as unknown[],
      id: itemId,
      role: 'assistant',
      status: 'in_progress',
      type: 'message',
    };
    emit({ item, output_index: 0, response_id: responseId, type: 'response.output_item.added' });
    emit({
      content_index: 0,
      item_id: itemId,
      output_index: 0,
      part: { annotations: [], text: '', type: 'output_text' },
      response_id: responseId,
      type: 'response.content_part.added',
    });
    emit({
      content_index: 0,
      delta: action.content,
      item_id: itemId,
      output_index: 0,
      response_id: responseId,
      type: 'response.output_text.delta',
    });
    const part = { annotations: [], text: action.content, type: 'output_text' };
    emit({
      content_index: 0,
      item_id: itemId,
      output_index: 0,
      part,
      response_id: responseId,
      type: 'response.content_part.done',
    });
    emit({
      item: { ...item, content: [part], status: 'completed' },
      output_index: 0,
      response_id: responseId,
      type: 'response.output_item.done',
    });
  }

  const completedItem =
    'name' in action
      ? {
          arguments: JSON.stringify(action.args),
          call_id: action.id,
          id: `fc-t105-${responseNumber}`,
          name: action.name,
          status: 'completed',
          type: 'function_call',
        }
      : {
          content: [{ annotations: [], text: action.content, type: 'output_text' }],
          id: `msg-t105-${responseNumber}`,
          role: 'assistant',
          status: 'completed',
          type: 'message',
        };
  emit({
    response: {
      ...response,
      completed_at: Math.floor(Date.now() / 1000),
      output: [completedItem],
      status: 'completed',
      usage,
    },
    type: 'response.completed',
  });
  res.end();
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-origin': '*',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url?.endsWith('/models')) {
    json(res, 200, {
      data: [{ created: 0, id: 'gpt-4o', object: 'model', owned_by: 'mock' }],
      object: 'list',
    });
    return;
  }

  const isChatCompletion = req.method === 'POST' && req.url?.endsWith('/chat/completions');
  const isResponse = req.method === 'POST' && req.url?.endsWith('/responses');
  if (!isChatCompletion && !isResponse) {
    json(res, 404, { error: { message: `Unexpected route: ${req.method} ${req.url}` } });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const rawRequest = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  const request = isResponse
    ? normalizeResponsesRequest(rawRequest)
    : (rawRequest as NormalizedRequest);
  const requestNumber = ++sequence;
  const capturedAt = new Date().toISOString();
  const fileStem = `${String(requestNumber).padStart(3, '0')}-${capturedAt.replaceAll(':', '-')}`;
  let action: { content: string } | ToolCall;
  if (isResponse) {
    // Auxiliary service calls (for example Agent Signal classification) also use
    // this provider. They are not product chat requests under test, so do not
    // run scenario actions that only make sense for Chat Completions.
    action = { content: 'T105 prompt capture complete.' };
  } else {
    try {
      action = chooseAction(request);
    } catch (error) {
      // Keep the request capture even when the deterministic mock cannot choose
      // an action. A crashing mock hides the very payload acceptance needs.
      console.error('Failed to choose mock action:', error);
      action = {
        content: `Mock provider could not choose an action: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  const response = isResponse ? undefined : completion(request, requestNumber, action);
  const envelope = {
    capturedAt,
    hashAlgorithm: 'prompt-harness-canonical-json-v1',
    hashes: hashPromptRequest(request),
    headers: redactHeaders(req.headers),
    method: req.method,
    mockResponse: response ?? { action, object: 'response', protocol: 'responses' },
    rawRequest,
    request,
    requestNumber,
    toolOrder: request.tools?.map((tool) => tool.function?.name) ?? [],
    url: req.url,
  };

  await writeFile(path.join(captureDir, `${fileStem}.json`), JSON.stringify(envelope, null, 2));
  await writeFile(path.join(captureDir, 'latest.json'), JSON.stringify(envelope, null, 2));
  await writeFile(
    path.join(captureDir, 'index.json'),
    JSON.stringify(
      {
        latestCapturedAt: capturedAt,
        requestCount: requestNumber,
      },
      null,
      2,
    ),
  );

  if (isResponse) {
    sendResponsesStream(res, request, requestNumber, action);
    return;
  }

  if (!response) {
    json(res, 500, { error: { message: 'Chat completion response was not constructed.' } });
    return;
  }
  if (!request.stream) {
    json(res, 200, response);
    return;
  }
  sendStream(res, response);
});

server.listen(mockPort, '127.0.0.1', () => {
  console.log(`T105 mock provider listening on http://127.0.0.1:${mockPort}/v1`);
  console.log(`captures: ${captureDir}`);
});
