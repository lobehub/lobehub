/**
 * LLM-facing text for a `getAgentDetail` result.
 *
 * Shared by the client `AgentManagerRuntime` and the server tool runtime so
 * both execution paths answer with the same shape. Every configuration field
 * the tool description promises (model, provider, plugins, system prompt) is
 * always written, with an explicit placeholder when it is empty — a line that
 * is silently dropped reads to the calling model as "this tool returns only
 * the title", which is exactly what it then reports to the user.
 */
import {
  type HeteroAgentRuntimeDescriptor,
  renderHeteroRuntimeLines,
} from './heteroAgentDescriptor';

export interface AgentDetailContentInput {
  config: {
    model?: string | null;
    plugins?: string[] | null;
    provider?: string | null;
    runtime?: HeteroAgentRuntimeDescriptor;
    systemRole?: string | null;
  };
  meta: {
    description?: string | null;
    title?: string | null;
  };
}

const NOT_SET = '(not set)';

export const buildAgentDetailContent = ({ config, meta }: AgentDetailContentInput): string => {
  const lines: string[] = [];

  if (meta.title) lines.push(`**${meta.title}**`);
  if (meta.description) lines.push(meta.description);

  lines.push(
    `Model: ${config.model || NOT_SET}`,
    `Provider: ${config.provider || NOT_SET}`,
    `Plugins: ${config.plugins?.length ? config.plugins.join(', ') : '(none)'}`,
    ...renderHeteroRuntimeLines(config.runtime),
    `System Prompt: ${config.systemRole?.trim() ? config.systemRole : '(empty)'}`,
  );

  return lines.join('\n');
};

export {
  describeHeterogeneousAgent,
  type HeteroAgentRuntimeDescriptor,
} from './heteroAgentDescriptor';
