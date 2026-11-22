import { pluginPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { LobeToolManifest } from '../engine/tools/types';
import { generateToolsFromManifest } from '../engine/tools/utils';
import { toToolPrompt } from '../providers/ToolSystemRole';
import type { Message, PipelineContext, ProcessorOptions } from '../types';
import {
  type ActivateToolsState,
  isActivateToolsCall,
  readActivatedToolIds,
} from '../utils/activatedTools';
import { ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE } from './ActivationResultTrim';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    toolActivationAnchor?: {
      /** Activation results that now declare the tools they activated. */
      anchoredMessages: number;
      /** Tools whose instructions had to go back to the system message. */
      fallbackToolIds: string[];
    };
    /**
     * Tools ToolSystemRoleProvider left out of the system message because their
     * activation result is in this request and carries their instructions instead.
     */
    toolActivationAnchors?: { toolIds: string[] };
  }
}

const log = debug('context-engine:processor:ToolActivationAnchorProcessor');

export const ACTIVATION_DOCS_FOLLOW_NOTE = 'Usage instructions for the activated tools follow.';
export const ACTIVATION_DOCS_FOLLOW_WITH_SKILLS_NOTE =
  'Usage instructions for the activated tools follow; skill instructions are in the system prompt.';

export interface ToolActivationAnchorConfig {
  /** Manifests of the tools enabled for this request, activated ones included. */
  manifests?: LobeToolManifest[];
}

/**
 * Makes an `activateTools` result the place where the tools it activated enter the
 * conversation, for a transport that can declare tools mid-conversation.
 *
 * Activating a tool used to change two things that sit ahead of the whole history: the
 * tool appeared in the top-level `tools` list, and its instructions were appended to
 * the system message. Either one invalidates the prompt cache for everything after it.
 * This processor keeps both where the activation happened instead:
 *
 * - `toolsAdded` on the result names the functions that became callable there, so the
 *   transport declares them at that message and leaves the top-level list alone.
 * - The instructions ToolSystemRoleProvider left out of the system message
 *   (`metadata.toolActivationAnchors`) are appended to the result. The text is
 *   rendered from the manifest, so it is identical on every request.
 *
 * A tool is anchored at the first result that activated it. If such a result did not
 * survive to this point, the instructions go back to the system message so the tool
 * is never left undocumented.
 *
 * Must run AFTER ActivationResultTrimProcessor (which rewrites the result to its short
 * deterministic form) and BEFORE ToolCallProcessor consumes the plugin payloads.
 */
export class ToolActivationAnchorProcessor extends BaseProcessor {
  readonly name = 'ToolActivationAnchorProcessor';

  private manifestsById: Map<string, LobeToolManifest>;

  constructor(config: ToolActivationAnchorConfig, options: ProcessorOptions = {}) {
    super(options);
    this.manifestsById = new Map((config.manifests ?? []).map((m) => [m.identifier, m]));
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.manifestsById.size === 0) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const relocatedToolIds = new Set(context.metadata.toolActivationAnchors?.toolIds ?? []);
    const anchoredToolIds = new Set<string>();
    let anchoredMessages = 0;

    clonedContext.messages = clonedContext.messages.map((message) => {
      if (message.role !== 'tool') return message;
      if (!isActivateToolsCall(message.plugin?.identifier, message.plugin?.apiName)) {
        return message;
      }

      const manifests = readActivatedToolIds(message.pluginState).flatMap((id) => {
        const manifest = this.manifestsById.get(id);
        if (!manifest || anchoredToolIds.has(id)) return [];
        anchoredToolIds.add(id);
        return [manifest];
      });
      if (manifests.length === 0) return message;

      anchoredMessages += 1;
      const toolsAdded = manifests.flatMap((manifest) =>
        generateToolsFromManifest(manifest).map((tool) => tool.function.name),
      );
      const documented = manifests.filter((manifest) => relocatedToolIds.has(manifest.identifier));

      return {
        ...message,
        ...(documented.length > 0 && { content: this.appendInstructions(message, documented) }),
        ...(toolsAdded.length > 0 && { toolsAdded }),
      };
    });

    const fallbackToolIds = [...relocatedToolIds].filter((id) => !anchoredToolIds.has(id));
    if (fallbackToolIds.length > 0) {
      log('Activation results missing for %o, restoring system instructions', fallbackToolIds);
      this.restoreSystemInstructions(clonedContext, fallbackToolIds);
    }

    clonedContext.metadata.toolActivationAnchor = { anchoredMessages, fallbackToolIds };
    return this.markAsExecuted(clonedContext);
  }

  private renderInstructions(manifests: LobeToolManifest[]): string {
    return pluginPrompts({ tools: manifests.map((manifest) => toToolPrompt(manifest)) });
  }

  private appendInstructions(message: Message, manifests: LobeToolManifest[]): string {
    const instructions = this.renderInstructions(manifests);
    const content = typeof message.content === 'string' ? message.content : '';
    if (!instructions) return content;

    const hasSkills =
      ((message.pluginState as ActivateToolsState | undefined)?.activatedSkills?.length ?? 0) > 0;
    const note = hasSkills ? ACTIVATION_DOCS_FOLLOW_WITH_SKILLS_NOTE : ACTIVATION_DOCS_FOLLOW_NOTE;

    // The result says where the instructions are; they are no longer in the system prompt.
    const body = content.includes(ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE)
      ? content.replace(ACTIVATION_DOCS_IN_SYSTEM_PROMPT_NOTE, note)
      : [content, note].filter(Boolean).join('\n');

    return `${body}\n\n${instructions}`;
  }

  private restoreSystemInstructions(context: PipelineContext, toolIds: string[]): void {
    const instructions = this.renderInstructions(
      toolIds.flatMap((id) => {
        const manifest = this.manifestsById.get(id);
        return manifest ? [manifest] : [];
      }),
    );
    if (!instructions) return;

    const systemIndex = context.messages.findIndex((message) => message.role === 'system');
    if (systemIndex >= 0) {
      const existing = context.messages[systemIndex];
      context.messages[systemIndex] = {
        ...existing,
        content: [existing.content, instructions].filter(Boolean).join('\n\n'),
      };
      return;
    }

    context.messages.unshift({
      content: instructions,
      createdAt: Date.now(),
      id: `system-${this.name}`,
      role: 'system',
      updatedAt: Date.now(),
    } as Message);
  }
}
