import type { StreamProtocolChunk, StreamToolCallChunkData } from '../protocol';
import { generateToolCallId } from '../protocol';

const SEED_TOOL_CALL_START = /seed:tool_call/i;
const SEED_TOOL_CALL_END = /<\/seed:tool_call>/i;

export interface ParsedSeedToolCall {
  arguments: Record<string, unknown>;
  name: string;
}

export const isDoubaoSeedModel = (model?: string): boolean => {
  if (!model) return false;

  const normalized = model.toLowerCase();

  return normalized.includes('doubao-seed') || normalized.includes('doubao_seed');
};

const parseParameterValue = (raw: string, stringAttr?: string): unknown => {
  const trimmed = raw.trim();

  if (stringAttr === 'true') return trimmed;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

/**
 * Parse a complete Doubao Seed `seed:tool_call` XML block into a tool call payload.
 *
 * Example:
 * seed:tool_call<function name="lobe-creds____injectCredsToSandbox">
 *   <parameter name="keys" string="false">["shuyou"]</parameter>
 * </function></seed:tool_call>
 */
export const parseSeedToolCallBlock = (block: string): ParsedSeedToolCall | null => {
  if (!SEED_TOOL_CALL_START.test(block) || !SEED_TOOL_CALL_END.test(block)) return null;

  const nameMatch = block.match(/<function\s+name="([^"]+)"/i);
  if (!nameMatch?.[1]) return null;

  const args: Record<string, unknown> = {};
  const paramRegex =
    /<parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/parameter>/gi;

  let match: RegExpExecArray | null;
  while ((match = paramRegex.exec(block)) !== null) {
    const [, paramName, stringAttr, rawValue] = match;
    if (!paramName) continue;

    args[paramName] = parseParameterValue(rawValue ?? '', stringAttr);
  }

  return {
    arguments: args,
    name: nameMatch[1],
  };
};

const toToolCallsChunk = (
  parsed: ParsedSeedToolCall,
  id?: string,
  index = 0,
): StreamProtocolChunk => {
  const toolCall: StreamToolCallChunkData = {
    function: {
      arguments: JSON.stringify(parsed.arguments),
      name: parsed.name,
    },
    id: generateToolCallId(index, parsed.name),
    index,
    type: 'function',
  };

  return {
    data: [toolCall],
    id,
    type: 'tool_calls',
  };
};

export interface SeedToolCallExtractionResult {
  chunks: StreamProtocolChunk[];
  remainingBuffer: string;
}

/**
 * Incrementally extract complete `seed:tool_call` blocks from streamed text.
 * Incomplete blocks are kept in `remainingBuffer` until the closing tag arrives.
 */
export const extractSeedToolCallsFromText = (
  delta: string,
  buffer = '',
): SeedToolCallExtractionResult => {
  let working = `${buffer}${delta}`;
  const chunks: StreamProtocolChunk[] = [];

  while (working.length > 0) {
    const startMatch = working.match(SEED_TOOL_CALL_START);
    const startIdx = startMatch?.index;

    if (startIdx === undefined) {
      if (working) chunks.push({ data: working, type: 'text' });
      working = '';
      break;
    }

    if (startIdx > 0) {
      chunks.push({ data: working.slice(0, startIdx), type: 'text' });
      working = working.slice(startIdx);
    }

    const endMatch = working.match(SEED_TOOL_CALL_END);
    if (!endMatch || endMatch.index === undefined) {
      break;
    }

    const endIdx = endMatch.index + endMatch[0].length;
    const block = working.slice(0, endIdx);
    working = working.slice(endIdx);

    const parsed = parseSeedToolCallBlock(block);
    if (parsed) {
      chunks.push(toToolCallsChunk(parsed));
    } else {
      chunks.push({ data: block, type: 'text' });
    }
  }

  return {
    chunks,
    remainingBuffer: working,
  };
};

export const flushSeedToolCallBuffer = (buffer: string): StreamProtocolChunk[] => {
  if (!buffer) return [];

  const parsed = parseSeedToolCallBlock(buffer);
  if (parsed) return [toToolCallsChunk(parsed)];

  return [{ data: buffer, type: 'text' }];
};
