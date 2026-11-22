import { pluginPrompts } from '@lobechat/prompts';
import type { ToolActivationPlan } from '@lobechat/types';

import { BaseProcessor } from '../base/BaseProcessor';
import type { LobeToolManifest } from '../engine/tools/types';
import { generateToolsFromManifest } from '../engine/tools/utils';
import { toToolPrompt } from '../providers/ToolSystemRole';
import type { PipelineContext, ProcessorOptions } from '../types';
import {
  type ActivateToolsState,
  isActivateToolsCall,
  readActivatedToolIds,
} from '../utils/activatedTools';
import { ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE } from './ActivationResultTrim';
import { parsePlaceholderVariables } from './PlaceholderVariables';

export interface ToolActivationAnchorConfig {
  manifests?: LobeToolManifest[];
  variableGenerators?: Record<string, () => string>;
}

/**
 * Keep the ordinary system and tool messages intact. Prepare an optional edit after
 * history truncation, role folding, disabled-call filtering and tool pairing. Only the
 * transport knows its final endpoint, mapped model and effective tool set.
 */
export class ToolActivationAnchorProcessor extends BaseProcessor {
  readonly name = 'ToolActivationAnchorProcessor';

  constructor(
    private config: ToolActivationAnchorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const { manifests = [], variableGenerators = {} } = this.config;
    const system = context.messages.find((message) => message.role === 'system');
    if (!manifests.length || typeof system?.content !== 'string')
      return this.markAsExecuted(context);

    const render = (tools: LobeToolManifest[]) =>
      parsePlaceholderVariables(
        pluginPrompts({ tools: tools.map(toToolPrompt) }),
        variableGenerators,
      );
    const remaining = new Map(manifests.map((manifest) => [manifest.identifier, manifest]));
    const results: ToolActivationPlan['results'] = [];
    let firstResultIndex = -1;
    for (const [index, message] of context.messages.entries()) {
      if (
        message.role !== 'tool' ||
        !message.tool_call_id ||
        typeof message.content !== 'string' ||
        !isActivateToolsCall(message.plugin?.identifier, message.plugin?.apiName)
      )
        continue;
      const activated: LobeToolManifest[] = [];
      for (const id of readActivatedToolIds(message.pluginState)) {
        const manifest = remaining.get(id);
        if (!manifest?.api.length) continue;
        remaining.delete(id);
        activated.push(manifest);
      }
      if (!activated.length) continue;
      const note = (message.pluginState as ActivateToolsState)?.activatedSkills?.length
        ? 'Usage instructions for the activated tools follow; skill instructions are in the system prompt.'
        : 'Usage instructions for the activated tools follow.';
      const body = message.content.includes(ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE)
        ? message.content.replace(ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE, note)
        : [message.content, note].filter(Boolean).join('\n');
      results.push({
        callId: message.tool_call_id,
        content: [body, render(activated)].join('\n\n'),
        toolNames: activated.flatMap((manifest) =>
          generateToolsFromManifest(manifest).map((tool) => tool.function.name),
        ),
      });
      if (firstResultIndex < 0) firstResultIndex = index;
    }
    if (firstResultIndex < 0) return this.markAsExecuted(context);

    const plan: ToolActivationPlan = { results };
    // An explicit replacement document owns the whole system prompt. Only the
    // activation result needs to change when this transport can anchor the tools.
    if (!context.metadata.agentDocumentSystemReplace?.replaced) {
      let original = render(manifests);
      let start = system.content.indexOf(original);
      // A later injector or a volatile placeholder may have changed this section.
      // In that case the canonical system message remains the source of instructions.
      if (start < 0 || system.content.includes(original, start + 1))
        return this.markAsExecuted(context);
      const replacement = render([...remaining.values()]);
      if (!replacement) {
        if (start >= 2 && system.content.slice(start - 2, start) === '\n\n') {
          start -= 2;
          original = '\n\n' + original;
        } else if (system.content.slice(start + original.length).startsWith('\n\n')) {
          original += '\n\n';
        }
      }
      plan.system = { original, replacement, start };
    }
    const processed = this.cloneContext(context);
    processed.messages[firstResultIndex] = {
      ...processed.messages[firstResultIndex],
      toolActivationPlan: plan,
    };
    return this.markAsExecuted(processed);
  }
}
