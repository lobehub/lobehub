import debug from 'debug';

import { AgentRuntimeErrorType } from '../../types/error';
import { safeParseJSON } from '../../utils/safeParseJSON';
import type { StreamProtocolChunk, StreamToolCallChunkData } from './protocol';
import { generateToolCallId } from './protocol';

/**
 * Text-protocol tool call fallback.
 *
 * Self-hosted inference servers (e.g. vLLM without `--tool-call-parser`) return the
 * tool calls of Qwen-family models as plain text instead of native `tool_calls`:
 *
 *   <tool_call>
 *   <function=NAME>
 *   <parameter=KEY>VALUE</parameter>
 *   </function>
 *   </tool_call>
 *
 * or the JSON variant `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`.
 * Without a fallback the block renders as message text and no tool runs, so the agent
 * loop silently stops. This transformer buffers such blocks out of the text stream and
 * re-emits them as standard `tool_calls` chunks.
 *
 * Guards against false positives: it only runs when the request declared tools, the
 * opening tag must start a line outside a fenced code block, the called function must
 * be one of the declared tools, and the whole fallback turns off once the provider
 * returns any native `tool_calls`.
 *
 * A buffered call is released in one piece once closed, so unlike native tool calls its
 * arguments do not stream into the UI while the model is still writing them.
 */

const OPEN_TAG = '<tool_call>';
const CLOSE_TAG = '</tool_call>';
// The delimiter run of a Markdown fence line. As in CommonMark, four spaces or a tab
// make it indented code instead.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const XML_FUNCTION = /^<function=([^\s>]+)>([\s\S]*?)<\/function>\s*$/;
const XML_FUNCTION_NAME = /^<function=([^\s>]+)>/;
// Only used to decide whether a JSON block that failed to parse deserves an error.
const JSON_FUNCTION_NAME = /"name"\s*:\s*"([^"\\]+)"/;
// Non-greedy like vLLM's qwen3_coder parser: a literal `</parameter>` inside a value
// ends that value early.
const XML_PARAMETER = /<parameter=([^\s>]+)>([\s\S]*?)<\/parameter>/g;

const log = debug('lobe-model-runtime:text-tool-calls');

export const TEXT_TOOL_CALL_FALLBACK_DISABLED_ENV = 'DISABLE_TEXT_TOOL_CALL_FALLBACK';

export const isTextToolCallFallbackDisabled = () =>
  typeof process !== 'undefined' && process.env?.[TEXT_TOOL_CALL_FALLBACK_DISABLED_ENV] === '1';

/**
 * Structural shape of a declared tool. Loose on purpose: requests carry both our own and
 * OpenAI SDK tool types, and tools without a function (e.g. custom tools) are ignored.
 */
export interface TextToolCallTool {
  function?: { name?: string; parameters?: unknown };
  type?: string;
}

export interface ParsedTextToolCall {
  arguments: string;
  name: string;
}

type ToolSchemas = Map<string, unknown>;

const stripEdgeNewline = (value: string) => value.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

/** `string`, or a union of `string` with `null` such as `['string', 'null']`. */
const isStringSchema = (schema: any) => {
  const types = [schema?.type].flat().filter((type) => type !== 'null');
  return types.length > 0 && types.every((type) => type === 'string');
};

const convertParameterValue = (raw: string, schema: any): unknown => {
  const value = stripEdgeNewline(raw);
  if (isStringSchema(schema)) {
    const nullable = [schema.type].flat().includes('null');
    return nullable && value.trim() === 'null' ? null : value;
  }

  const trimmed = value.trim();
  // Without a declared type only structured JSON is decoded, so "123" stays a string.
  if (!schema && !/^[[{]/.test(trimmed)) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

/**
 * Parse the body between `<tool_call>` and `</tool_call>`. Returns `undefined` when
 * the body is neither the XML nor the JSON protocol, or names an undeclared tool.
 */
export const parseTextToolCallBody = (
  body: string,
  schemas: ToolSchemas,
): ParsedTextToolCall | undefined => {
  const content = body.trim();

  const xml = content.match(XML_FUNCTION);
  if (xml) {
    const [, name, paramsBlock] = xml;
    if (!schemas.has(name)) return;
    // Anything besides complete parameters (e.g. one cut off before `</parameter>`) means
    // the arguments are incomplete: never run a tool with part of them.
    if (paramsBlock.replaceAll(XML_PARAMETER, '').trim()) return;

    const properties = (schemas.get(name) as any)?.properties;
    const args: Record<string, unknown> = {};
    for (const [, key, value] of paramsBlock.matchAll(XML_PARAMETER)) {
      args[key] = convertParameterValue(value, properties?.[key]);
    }

    return { arguments: JSON.stringify(args), name };
  }

  if (content.startsWith('{')) {
    const json = safeParseJSON<{ arguments?: unknown; name?: unknown; parameters?: unknown }>(
      content,
    );
    if (!json || typeof json.name !== 'string' || !schemas.has(json.name)) return;

    const args = json.arguments ?? json.parameters ?? {};

    return {
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      name: json.name,
    };
  }
};

/** Whether the JSON text has closed its outermost value and is not inside a string. */
const isJsonBalanced = (json: string) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return depth <= 0 && !inString;
};

/**
 * Whether a `</tool_call>` found at `index` ends the envelope rather than sitting inside
 * an argument: a JSON string or an XML parameter value still being written.
 */
const isEnvelopeEnd = (body: string, index: number) => {
  const head = body.slice(0, index);
  const content = head.trimStart();
  if (content.startsWith('{')) return isJsonBalanced(content);

  const openParameter = head.lastIndexOf('<parameter=');
  return openParameter === -1 || head.includes('</parameter>', openParameter);
};

const looksLikeToolCall = (body: string) => {
  const content = body.trimStart();
  return content.startsWith('<function=') || content.startsWith('{');
};

export const createTextToolCallTransformer = (tools?: readonly TextToolCallTool[]) => {
  const schemas: ToolSchemas = new Map();
  for (const tool of tools ?? []) {
    if (tool?.function?.name) schemas.set(tool.function.name, tool.function.parameters);
  }

  // Not applicable: pass every chunk through untouched.
  if (schemas.size === 0) return new TransformStream<StreamProtocolChunk, StreamProtocolChunk>();

  let disabled = false;
  let pending = '';
  let inToolCall = false;
  let toolCallBody = '';
  // Where the next `</tool_call>` search starts: earlier text is already ruled out.
  let closeSearchFrom = 0;
  // Emitted text since the last newline, plus fenced-code state, decide whether an
  // opening tag may start here.
  let currentLine = '';
  // The delimiter that opened the current fenced block, e.g. "````" or "~~~".
  let openFence: string | undefined;
  let toolIndex = 0;
  let lastId = '';

  type Controller = TransformStreamDefaultController<StreamProtocolChunk>;

  // Native calls after converted ones must not reuse their indexes, or their argument
  // deltas would merge into the converted calls.
  const shiftNativeIndexes = (chunk: StreamProtocolChunk): StreamProtocolChunk =>
    chunk.type === 'tool_calls' && toolIndex > 0
      ? {
          ...chunk,
          data: (chunk.data as StreamToolCallChunkData[]).map((item) => ({
            ...item,
            index: item.index + toolIndex,
          })),
        }
      : chunk;

  const emitText = (controller: Controller, text: string) => {
    if (!text) return;
    controller.enqueue({ data: text, id: lastId, type: 'text' });

    const lines = text.split('\n');
    for (const line of lines.slice(0, -1)) {
      const fullLine = currentLine + line;
      const fence = fullLine.match(FENCE_LINE);
      const info = fence ? fullLine.slice(fence[0].length) : '';
      // A backtick fence's info string cannot contain backticks (e.g. ```js `x` is text).
      if (fence && !openFence && !(fence[1][0] === '`' && info.includes('`'))) {
        openFence = fence[1];
      } else if (
        fence &&
        // CommonMark: only the same character, at least as long, with nothing after it
        fence[1][0] === openFence?.[0] &&
        fence[1].length >= openFence.length &&
        !info.trim()
      ) {
        openFence = undefined;
      }
      currentLine = '';
    }
    currentLine += lines.at(-1)!;
  };

  const emitToolCall = (controller: Controller, call: ParsedTextToolCall) => {
    const data: StreamToolCallChunkData[] = [
      {
        function: { arguments: call.arguments, name: call.name },
        id: generateToolCallId(toolIndex, call.name),
        index: toolIndex,
        type: 'function',
      },
    ];
    toolIndex += 1;
    currentLine = '';
    log('converted text tool call %s', call.name);
    controller.enqueue({ data, id: lastId, type: 'tool_calls' });
  };

  const settleToolCall = (controller: Controller, body: string, closed: boolean) => {
    const call = parseTextToolCallBody(body, schemas);
    if (call) return emitToolCall(controller, call);

    emitText(controller, OPEN_TAG + body + (closed ? CLOSE_TAG : ''));
    log('restored a %s <tool_call> block as text', closed ? 'non-matching' : 'unclosed');

    // A closed block is only an error when it calls a declared tool; otherwise it is text.
    const content = body.trim();
    const calledName =
      content.match(XML_FUNCTION_NAME)?.[1] ??
      (content.startsWith('{') ? content.match(JSON_FUNCTION_NAME)?.[1] : undefined) ??
      '';
    const malformed = closed && schemas.has(calledName);
    if ((!closed && looksLikeToolCall(body)) || malformed) {
      controller.enqueue({
        data: {
          body: {
            name: 'TextToolCallParseError',
            reason: malformed ? 'malformed_tool_call' : 'unclosed_tool_call',
          },
          message: `The model output ${malformed ? 'a malformed' : 'an unclosed'} <tool_call> block, so the tool call could not be executed. Check that the inference server is configured with a tool-call parser for this model.`,
          name: 'TextToolCallParseError',
          type: AgentRuntimeErrorType.ModelTextToolCallError,
        },
        id: lastId,
        type: 'error',
      });
    }
  };

  /** Move as much of `pending` out as can be decided without more input. */
  const drain = (controller: Controller, final: boolean) => {
    while (pending) {
      if (inToolCall) {
        toolCallBody += pending;
        pending = '';

        let closeIndex = toolCallBody.indexOf(CLOSE_TAG, closeSearchFrom);
        while (closeIndex !== -1 && !isEnvelopeEnd(toolCallBody, closeIndex)) {
          closeIndex = toolCallBody.indexOf(CLOSE_TAG, closeIndex + 1);
        }
        if (closeIndex === -1) {
          // A closing tag split across chunks may still start in the last few characters.
          closeSearchFrom = Math.max(0, toolCallBody.length - CLOSE_TAG.length + 1);
          break;
        }

        pending = toolCallBody.slice(closeIndex + CLOSE_TAG.length);
        const body = toolCallBody.slice(0, closeIndex);
        inToolCall = false;
        toolCallBody = '';
        settleToolCall(controller, body, true);
        continue;
      }

      const newlineIndex = pending.indexOf('\n');
      const untilNextLine = newlineIndex === -1 ? pending : pending.slice(0, newlineIndex + 1);

      // An opening tag can only start a line outside fenced code.
      if (openFence || currentLine.trim()) {
        emitText(controller, untilNextLine);
        pending = pending.slice(untilNextLine.length);
        continue;
      }

      // Up to three spaces, as in CommonMark: four spaces or a tab start indented code.
      // The indentation emitted from earlier chunks of this line counts too.
      const lineIndent = (currentLine + pending).match(/^ {0,3}/)![0];
      if (lineIndent.length < currentLine.length) {
        emitText(controller, untilNextLine);
        pending = pending.slice(untilNextLine.length);
        continue;
      }

      const indent = lineIndent.slice(currentLine.length);
      const rest = pending.slice(indent.length);

      if (rest.startsWith(OPEN_TAG)) {
        emitText(controller, indent);
        pending = rest.slice(OPEN_TAG.length);
        inToolCall = true;
        closeSearchFrom = 0;
        continue;
      }

      // Possibly the start of an opening tag split across chunks: wait for more.
      if (OPEN_TAG.startsWith(rest) && !final) break;

      emitText(controller, untilNextLine);
      pending = pending.slice(untilNextLine.length);
    }

    if (final && inToolCall) {
      const body = toolCallBody;
      inToolCall = false;
      toolCallBody = '';
      // A complete function block missing only its closing tag is still executable.
      settleToolCall(controller, body, false);
    }
  };

  return new TransformStream<StreamProtocolChunk, StreamProtocolChunk>({
    flush(controller) {
      drain(controller, true);
    },
    transform(chunk, controller) {
      if (chunk.id) lastId = chunk.id;

      if (disabled) return controller.enqueue(shiftNativeIndexes(chunk));

      if (chunk.type === 'text' && typeof chunk.data === 'string') {
        pending += chunk.data;
        return drain(controller, false);
      }

      if (chunk.type === 'tool_calls') {
        // The provider speaks native tool calls: restore anything held back as text.
        disabled = true;
        if (inToolCall) {
          pending = OPEN_TAG + toolCallBody + pending;
          inToolCall = false;
          toolCallBody = '';
        }
        emitText(controller, pending);
        pending = '';
        return controller.enqueue(shiftNativeIndexes(chunk));
      }

      if (chunk.type === 'stop') drain(controller, true);

      controller.enqueue(chunk);
    },
  });
};
