import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import {
  generateToolsFromManifest,
  renderPlaceholderTemplate,
  renderToolInstructions,
  type ResolvedToolSet,
} from '@lobechat/context-engine';
import { createVariableGenerators } from '@lobechat/mecha';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import type { ResolveToolActivationContext, ToolActivationContext } from '@lobechat/types';

import {
  serverMessagesEngine,
  type ServerMessagesEngineParams,
} from '@/server/modules/Mecha/ContextEngineering';

function systemContent(messages: ChatStreamPayload['messages']): string | undefined {
  const first = messages[0];
  return first?.role === 'system' && typeof first.content === 'string' ? first.content : undefined;
}

export function createToolActivationResolver(
  state: AgentState,
  resolved: ResolvedToolSet,
  input: ServerMessagesEngineParams,
  canonicalMessages: ChatStreamPayload['messages'],
): ResolveToolActivationContext | undefined {
  const initial = state.operationToolSet;
  if (!initial || !resolved.enabledToolIds.includes(LobeActivatorIdentifier)) return;
  // Keep evaluation runs using their session clock on the canonical, hydrated prompt.
  if (!state.activatedStepTools?.length || input.evalContext?.sessionDate) return;
  // The same step can be retried on another provider route; share its lazy reconstruction.
  let pending: ReturnType<ResolveToolActivationContext> | undefined;
  const resolve: ResolveToolActivationContext = async () => {
    const additions: ToolActivationContext['additions'] = [];
    const deferred = new Set<string>();
    const variableGenerators = createVariableGenerators({
      model: input.model,
      provider: input.provider,
      timezone: input.userTimezone,
      variables: input.additionalVariables,
    });
    const visibleResults = new Set(
      canonicalMessages
        .filter((message) => message.role === 'tool')
        .map((message) => message.tool_call_id),
    );
    for (const activation of state.activatedStepTools ?? []) {
      const manifest = resolved.promptManifestMap[activation.id];
      if (
        !activation.afterToolCallId ||
        !visibleResults.has(activation.afterToolCallId) ||
        !manifest ||
        initial.enabledToolIds.includes(activation.id)
      )
        continue;
      // The identity injector also changes the system instructions when account access becomes available.
      // Retain that canonical prompt when the step has an identity block.
      if (
        activation.id === AgentAccountIdentifier &&
        input.agentAccountContext &&
        (input.agentAccountContext.accounts.length > 0 ||
          input.agentAccountContext.inbox.unreadCount > 0)
      )
        return;
      const instructions = renderPlaceholderTemplate(
        renderToolInstructions([manifest]),
        variableGenerators,
      );
      additions.push({
        afterToolCallId: activation.afterToolCallId,
        instructions,
        names: generateToolsFromManifest(manifest).map((tool) => tool.function.name),
      });
      deferred.add(activation.id);
    }
    if (additions.length === 0) return { additions };

    // Reuse the authorized snapshot. `<available_tools>` and `SystemDateProvider`
    // stay stable across mid-operation tool activations, so only the leading system
    // message needs to be projected back to its pre-activation tool instructions.
    const enabled = resolved.enabledToolIds.filter((id) => !deferred.has(id));
    const baseline = await serverMessagesEngine({
      ...input,
      toolsConfig: {
        ...input.toolsConfig,
        tools: enabled,
        manifests: input.toolsConfig?.manifests?.filter(
          (manifest) => !deferred.has(manifest.identifier),
        ),
      },
    });
    const current = systemContent(canonicalMessages);
    const original = systemContent(baseline.messages);
    if (current !== undefined && original !== undefined) {
      return { additions, system: { current, initial: original } };
    }
  };
  return () => (pending ??= resolve());
}
