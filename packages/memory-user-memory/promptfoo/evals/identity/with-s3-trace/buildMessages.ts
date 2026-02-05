import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderPlaceholderTemplate } from '@lobechat/context-engine';

interface TracePayload {
  agentCalls?: Record<string, any>;
  contexts?: {
    trimmed?: {
      retrievedContexts?: string[];
      retrievedIdentitiesContext?: string;
    };
  };
  extractionJob?: {
    sourceUpdatedAt?: string;
  };
}

export interface PromptVars {
  availableCategories?: string[];
  language?: string;
  sessionDate?: string;
  topK?: number;
  tracePath: string;
  username?: string;
}

const parseLanguageFromTrace = (trace: TracePayload): string | undefined => {
  const requestMessages = trace.agentCalls?.['layer-identity']?.request?.messages;
  const userMessageContent = requestMessages?.[1]?.content;
  if (typeof userMessageContent !== 'string') return undefined;

  const match = userMessageContent.match(/ensure all the content is using ([^\n.]+)\./i);
  return match?.[1];
};

export const buildIdentityDedupeMessages = async (vars: PromptVars) => {
  const traceRaw = await readFile(vars.tracePath, 'utf8');
  const trace = JSON.parse(traceRaw) as TracePayload;

  const promptTemplate = await readFile(
    join(process.cwd(), 'src/prompts/layers/identity.md'),
    'utf8',
  );

  const retrievedContexts = trace.contexts?.trimmed?.retrievedContexts ?? [];
  const existingIdentitiesContext = trace.contexts?.trimmed?.retrievedIdentitiesContext ?? '';

  const language = vars.language || parseLanguageFromTrace(trace) || 'zh-CN';
  const username = vars.username || 'User';
  const sessionDate =
    vars.sessionDate || trace.extractionJob?.sourceUpdatedAt || new Date().toISOString();
  const topK = vars.topK ?? 10;

  const rendered = renderPlaceholderTemplate(promptTemplate, {
    availableCategories: vars.availableCategories,
    existingIdentitiesContext,
    language,
    retrievedContext: retrievedContexts.join('\n\n') || 'No similar memories retrieved.',
    sessionDate,
    topK,
    username,
  });

  return [
    { content: rendered, role: 'system' },
    { content: rendered, role: 'user' },
  ];
};
