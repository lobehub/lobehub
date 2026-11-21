import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  generateToolsFromManifest,
  renderToolInstructions,
  type ResolvedToolSet,
} from '@lobechat/context-engine';
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
  return async () => {
    const additions: ToolActivationContext['additions'] = [];
    const deferred = new Set<string>();
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
      const instructions = renderToolInstructions([manifest]);
      // A templated manifest must keep the context engine's variable hydration.
      if (instructions.includes('{{') || input.evalContext?.sessionDate) continue;
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
}
