import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type {
  ClaudeCodeHistoryMessage,
  ClaudeCodeHistoryToolUse,
  ClaudeCodeSessionHistoryResult,
} from '@lobechat/electron-client-ipc';

const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SCAN_FILES = 2000;

const normalizePathForClaudeProject = (cwd: string): string => {
  const normalized = path.resolve(cwd).replaceAll('\\', '/');
  return normalized.replaceAll(/[^A-Z0-9]/gi, '-');
};

const isSafeSessionId = (sessionId: string): boolean => {
  const trimmed = sessionId.trim();

  if (!trimmed || trimmed !== sessionId) return false;
  if (sessionId === '.' || sessionId === '..') return false;
  if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes(':')) return false;
  if (path.isAbsolute(sessionId)) return false;

  return path.basename(sessionId) === sessionId;
};

const stableEventId = (sessionId: string, lineNumber: number, value: Record<string, unknown>) => {
  const uuid = typeof value.uuid === 'string' ? value.uuid : undefined;
  if (uuid) return `${sessionId}:${uuid}`;

  return `${sessionId}:line:${lineNumber}:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)}`;
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractContentText = (value: unknown, options?: { includeThinking?: boolean }): string => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return stringifyUnknown(value);

  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;

    switch (block.type) {
      case 'text': {
        if (typeof block.text === 'string') parts.push(block.text);
        break;
      }
      case 'thinking': {
        if (options?.includeThinking && typeof block.thinking === 'string')
          parts.push(block.thinking);
        break;
      }
      case 'tool_result': {
        const content = extractContentText(block.content, options);
        if (content.trim()) parts.push(content);
        break;
      }
    }
  }

  return parts.join('\n\n');
};

const extractThinkingText = (value: unknown): string => {
  if (!Array.isArray(value)) return '';

  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'thinking' && typeof block.thinking === 'string') parts.push(block.thinking);
  }

  return parts.join('\n\n');
};

const extractToolUses = (value: unknown): ClaudeCodeHistoryToolUse[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const block = item as Record<string, unknown>;
    if (
      block.type !== 'tool_use' ||
      typeof block.id !== 'string' ||
      typeof block.name !== 'string'
    ) {
      return [];
    }

    return [
      {
        arguments: stringifyUnknown(block.input ?? {}),
        id: block.id,
        name: block.name,
      },
    ];
  });
};

const extractToolResults = (value: unknown): { content: string; toolUseId: string }[] => {
  if (!Array.isArray(value)) return [];

  const results: { content: string; toolUseId: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;

    results.push({
      content: extractContentText(block.content, { includeThinking: false }),
      toolUseId: block.tool_use_id,
    });
  }

  return results;
};

const toHistoryMessages = (
  value: Record<string, unknown>,
  lineNumber: number,
  sessionId: string,
): ClaudeCodeHistoryMessage[] => {
  if (value.isMeta === true) return [];
  const message = value.message;
  if (!message || typeof message !== 'object') return [];

  const rawMessage = message as Record<string, unknown>;
  const rawRole = rawMessage.role;
  if (rawRole !== 'user' && rawRole !== 'assistant') return [];

  const rawContent = rawMessage.content;
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : undefined;
  const messageId = typeof rawMessage.id === 'string' ? rawMessage.id : undefined;
  const parentUuid = typeof value.parentUuid === 'string' ? value.parentUuid : undefined;
  const uuid = typeof value.uuid === 'string' ? value.uuid : undefined;

  if (rawRole === 'user') {
    const toolResults = extractToolResults(rawContent);
    if (toolResults.length > 0) {
      return toolResults.map((toolResult, index) => ({
        content: toolResult.content,
        lineNumber,
        messageId,
        parentUuid,
        role: 'tool',
        sourceEventId: `${stableEventId(sessionId, lineNumber, value)}:tool:${toolResult.toolUseId}:${index}`,
        timestamp,
        toolCallId: toolResult.toolUseId,
        toolResultForId: toolResult.toolUseId,
        tools: [],
        uuid,
      }));
    }
  }

  const tools = rawRole === 'assistant' ? extractToolUses(rawContent) : [];
  const content = extractContentText(rawContent, { includeThinking: false });
  const reasoning = rawRole === 'assistant' ? extractThinkingText(rawContent) : undefined;

  if (!content.trim() && tools.length === 0) return [];

  return [
    {
      content,
      lineNumber,
      messageId,
      parentUuid,
      reasoning: reasoning || undefined,
      role: rawRole,
      sourceEventId: stableEventId(sessionId, lineNumber, value),
      timestamp,
      tools,
      uuid,
    },
  ];
};

const readHistoryFile = async (
  filePath: string,
  sessionId: string,
): Promise<ClaudeCodeHistoryMessage[]> => {
  const fileStat = await stat(filePath);
  if (fileStat.size > MAX_SESSION_FILE_BYTES) return [];

  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ crlfDelay: Infinity, input });
  const messages: ClaudeCodeHistoryMessage[] = [];
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;

    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      messages.push(...toHistoryMessages(value, lineNumber, sessionId));
    } catch {
      continue;
    }
  }

  return messages;
};

const collectJsonlFiles = async (
  dir: string,
  limit: number,
  files: string[] = [],
): Promise<string[]> => {
  if (files.length >= limit) return files;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (files.length >= limit) break;
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await collectJsonlFiles(entryPath, limit, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
      files.push(entryPath);
    }
  }

  return files;
};

const resolveCandidateFiles = async (
  sessionId: string,
  workingDirectory: string,
): Promise<string[]> => {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const projectDir = path.join(projectsRoot, normalizePathForClaudeProject(workingDirectory));
  const direct = path.join(projectDir, `${sessionId}.jsonl`);

  const candidates: string[] = [];
  try {
    const directStat = await stat(direct);
    if (directStat.isFile()) candidates.push(direct);
  } catch {
    // fall back to bounded scans below
  }

  const projectFiles = await collectJsonlFiles(projectDir, MAX_SCAN_FILES);
  candidates.push(...projectFiles.filter((file) => path.basename(file) === `${sessionId}.jsonl`));

  if (candidates.length === 0) {
    const allFiles = await collectJsonlFiles(projectsRoot, MAX_SCAN_FILES);
    candidates.push(...allFiles.filter((file) => path.basename(file) === `${sessionId}.jsonl`));
  }

  return [...new Set(candidates)];
};

export const getClaudeCodeSessionHistory = async ({
  sessionId,
  workingDirectory,
}: {
  sessionId: string;
  workingDirectory: string;
}): Promise<ClaudeCodeSessionHistoryResult> => {
  if (!sessionId || !workingDirectory || !isSafeSessionId(sessionId)) {
    return { messages: [], sessionId, status: 'invalid_request' };
  }

  const candidates = await resolveCandidateFiles(sessionId, workingDirectory);
  for (const sessionFile of candidates) {
    const messages = await readHistoryFile(sessionFile, sessionId);
    if (messages.length > 0) {
      return { messages, sessionFile, sessionId, status: 'found' };
    }
  }

  return { messages: [], sessionId, status: 'missing' };
};
