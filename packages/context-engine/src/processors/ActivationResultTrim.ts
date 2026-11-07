import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { LobeToolManifest } from '../engine/tools/types';
import type { SkillMeta } from '../providers/SkillContextProvider';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    activationResultTrim?: {
      savedChars: number;
      trimmedMessages: number;
    };
  }
}

const log = debug('context-engine:processor:ActivationResultTrimProcessor');

/**
 * Wire-format tool identifiers of the activation tools. Literal copies of
 * `LobeActivatorIdentifier` (@lobechat/builtin-tool-activator) and
 * `SkillsIdentifier` (@lobechat/builtin-tool-skills) — both are frozen,
 * persisted in DB message rows, and not importable here without adding
 * tool-package deps to context-engine (same rationale as agent-runtime's
 * messageSelectors).
 */
const ACTIVATOR_IDENTIFIER = 'lobe-activator';
const SKILLS_IDENTIFIER = 'lobe-skills';

interface ActivatedToolState {
  apiCount?: number;
  identifier?: string;
  name?: string;
}

interface ActivatedSkillState {
  identifier?: string;
  name?: string;
}

export interface ActivationResultTrimConfig {
  /**
   * Manifests whose systemRole / API descriptions the ToolSystemRoleProvider
   * injects into the system prompt for this request. Must be computed with
   * `selectToolPromptManifests` under the provider's own enablement gates
   * (manifests present + function calling supported); pass an empty array when
   * the provider is disabled so nothing gets trimmed.
   */
  injectedManifests?: LobeToolManifest[];
  /**
   * Activated skills whose full content the SkillContextProvider injects into
   * the system prompt for this request. Must be computed with
   * `selectActivatedSkills` under the provider's own enablement gates (agent
   * mode + enabled skills present); pass an empty array when the provider is
   * disabled so nothing gets trimmed.
   */
  injectedSkills?: SkillMeta[];
}

/**
 * Trims dynamic-activation tool results whose full documentation is ALSO
 * injected into the system prompt, so each activated tool/skill document
 * reaches the LLM payload exactly once.
 *
 * Background: `activateTools` used to write the manifest
 * systemRole + API descriptions into its `role=tool` result, and once
 * activated the same manifest enters ToolSystemRoleProvider's system-prompt
 * injection on every subsequent request — permanently double-carrying the
 * document. The activator now returns a short confirmation at the source, but
 * persisted history from before that change still carries the full docs, and
 * `activateSkill` (plus the activator's skill fallback) still returns the full
 * SKILL.md body because the tool result is the only content channel for
 * non-injected skills — so this payload-boundary trim remains load-bearing for
 * both.
 *
 * The trim happens ONLY at the payload assembly boundary — DB/UI rows keep the
 * full activation result — and ONLY when the injection is confirmed for this
 * request (condition-gated via the shared select helpers): a dynamically
 * activated skill that is NOT injected keeps its tool result as the single
 * content channel. The replacement text is deterministic, so once a document
 * moves to the system prompt the trimmed history stays byte-stable across
 * requests and keeps the prompt-cache prefix reusable.
 *
 * Must run AFTER the flatten processors (assistantGroup / compressedGroup
 * hoist nested tool results back into `role: 'tool'` rows with
 * plugin/pluginState re-attached) and BEFORE ToolCallProcessor consumes the
 * plugin payloads.
 */
export class ActivationResultTrimProcessor extends BaseProcessor {
  readonly name = 'ActivationResultTrimProcessor';

  private injectedManifestsById: Map<string, LobeToolManifest>;
  private injectedSkillsByIdentifier: Map<string, SkillMeta>;
  private injectedSkillsByName: Map<string, SkillMeta>;

  constructor(config: ActivationResultTrimConfig, options: ProcessorOptions = {}) {
    super(options);
    this.injectedManifestsById = new Map(
      (config.injectedManifests ?? []).map((m) => [m.identifier, m]),
    );
    this.injectedSkillsByIdentifier = new Map(
      (config.injectedSkills ?? []).map((s) => [s.identifier, s]),
    );
    // activateSkill resolves names case-insensitively, so match the same way.
    this.injectedSkillsByName = new Map(
      (config.injectedSkills ?? []).map((s) => [s.name.toLowerCase(), s]),
    );
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.injectedManifestsById.size === 0 && this.injectedSkillsByIdentifier.size === 0) {
      return this.markAsExecuted(context);
    }

    // A `system-replace` agent document discarded the assembled system message
    // AFTER the providers appended their docs — the injections this trim
    // relies on never reached the final prompt, so the activation results stay
    // the single content channel and must be kept intact.
    if (context.metadata.agentDocumentSystemReplace?.replaced) {
      log('System message was replaced by an agent document, skipping trim');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    let trimmedMessages = 0;
    let savedChars = 0;

    clonedContext.messages = clonedContext.messages.map((message) => {
      const trimmed = this.trimMessage(message);
      if (trimmed === undefined) return message;

      trimmedMessages += 1;
      savedChars += (message.content as string).length - trimmed.length;
      return { ...message, content: trimmed };
    });

    if (trimmedMessages > 0) {
      log('Trimmed %d activation result(s), saved %d chars', trimmedMessages, savedChars);
    }

    clonedContext.metadata.activationResultTrim = { savedChars, trimmedMessages };
    return this.markAsExecuted(clonedContext);
  }

  /** Returns the replacement content, or undefined when the message must stay untouched. */
  private trimMessage(message: Message): string | undefined {
    if (message.role !== 'tool') return undefined;
    if (typeof message.content !== 'string' || !message.content) return undefined;

    const plugin = message.plugin as { apiName?: string; identifier?: string } | undefined;
    if (!plugin) return undefined;

    if (plugin.identifier === ACTIVATOR_IDENTIFIER && plugin.apiName === 'activateTools') {
      return this.trimActivateToolsResult(message);
    }

    // Direct activateSkill calls arrive on the skills tool; the activator also
    // exposes the same API for identifier-based fallbacks.
    if (
      plugin.apiName === 'activateSkill' &&
      (plugin.identifier === SKILLS_IDENTIFIER || plugin.identifier === ACTIVATOR_IDENTIFIER)
    ) {
      return this.trimActivateSkillResult(message);
    }

    return undefined;
  }

  private findInjectedSkill(state: ActivatedSkillState): SkillMeta | undefined {
    const byIdentifier = state.identifier
      ? this.injectedSkillsByIdentifier.get(state.identifier)
      : undefined;
    if (byIdentifier) return byIdentifier;

    return state.name ? this.injectedSkillsByName.get(state.name.toLowerCase()) : undefined;
  }

  private trimActivateToolsResult(message: Message): string | undefined {
    const state = message.pluginState as
      | {
          activatedSkills?: ActivatedSkillState[];
          activatedTools?: ActivatedToolState[];
          alreadyActive?: string[];
          notFound?: string[];
        }
      | undefined;

    const activatedTools = Array.isArray(state?.activatedTools) ? state.activatedTools : [];
    const activatedSkills = Array.isArray(state?.activatedSkills)
      ? state.activatedSkills.filter(Boolean)
      : [];

    // Nothing was activated (pure already-active / not-found result) — the
    // content carries no document, leave it alone.
    if (activatedTools.length === 0 && activatedSkills.length === 0) return undefined;

    // Trim only when EVERY activated item is covered by a system-prompt
    // injection; the result content is a single blob, so a partially covered
    // activation must keep its full text as the only channel for the
    // uncovered items.
    const allToolsInjected = activatedTools.every(
      (tool) => tool.identifier && this.injectedManifestsById.has(tool.identifier),
    );
    const allSkillsInjected = activatedSkills.every((skill) => !!this.findInjectedSkill(skill));
    if (!allToolsInjected || !allSkillsInjected) return undefined;

    // Fallback-activated skills append their full activation content to the
    // blob, which may extend beyond the injected `skill.content` (resource
    // tree, project directory hint — same shape the direct activateSkill path
    // preserves). Locate each injected copy inside the blob and keep those
    // suffixes; when a copy cannot be located we cannot prove what extra
    // information the blob carries, so keep the full result untouched.
    let skillRemainders: string[] = [];
    if (activatedSkills.length > 0) {
      const extracted = this.extractFallbackSkillRemainders(
        message.content as string,
        activatedSkills,
      );
      if (!extracted) return undefined;
      skillRemainders = extracted;
    }

    const parts: string[] = [];

    // List the newly callable APIs (`identifier.apiName`) so the model knows
    // exactly which functions the activation added to the tools array.
    const activatedApiNames = activatedTools.flatMap((tool) => {
      const manifest = this.injectedManifestsById.get(tool.identifier!)!;
      return manifest.api.length > 0
        ? manifest.api.map((api) => `${tool.identifier}.${api.name}`)
        : [tool.identifier!];
    });
    if (activatedApiNames.length > 0) {
      parts.push(`Successfully activated tools: ${activatedApiNames.join(', ')}.`);
    }

    if (activatedSkills.length > 0) {
      const skillNames = activatedSkills.map((skill) => skill.name ?? skill.identifier);
      parts.push(`Activated skills: ${skillNames.join(', ')}.`);
      parts.push(...skillRemainders);
    }

    if (state?.alreadyActive?.length) {
      parts.push(`Already active: ${state.alreadyActive.join(', ')}.`);
    }
    if (state?.notFound?.length) {
      parts.push(`Not found: ${state.notFound.join(', ')}.`);
    }

    parts.push('Usage instructions for the activated items are in the system prompt.');

    return parts.join('\n');
  }

  /**
   * Locate each fallback-activated skill's injected content inside the
   * activateTools result blob (skill contents are appended in activation
   * order) and return the non-injected suffix that follows each copy, cut at
   * the next skill's content or the trailing `Already active:` / `Not found:`
   * sections. Returns undefined when any copy cannot be located.
   */
  private extractFallbackSkillRemainders(
    original: string,
    activatedSkills: ActivatedSkillState[],
  ): string[] | undefined {
    const positions: Array<{ end: number; start: number }> = [];
    let searchFrom = 0;

    for (const skill of activatedSkills) {
      const injected = this.findInjectedSkill(skill);
      // Coverage was already checked by the caller; bail defensively anyway.
      if (!injected?.content) return undefined;

      const start = original.indexOf(injected.content, searchFrom);
      if (start === -1) return undefined;

      const end = start + injected.content.length;
      positions.push({ end, start });
      searchFrom = end;
    }

    const remainders: string[] = [];
    for (const [index, position] of positions.entries()) {
      let to = index + 1 < positions.length ? positions[index + 1].start : original.length;
      // Matches the literal section labels ActivatorExecutionRuntime appends
      // after the skill contents.
      for (const label of ['\nAlready active:', '\nNot found:']) {
        const labelIndex = original.indexOf(label, position.end);
        if (labelIndex !== -1 && labelIndex < to) to = labelIndex;
      }

      const remainder = original.slice(position.end, to).trim();
      if (remainder) remainders.push(remainder);
    }

    return remainders;
  }

  private trimActivateSkillResult(message: Message): string | undefined {
    const state = message.pluginState as ActivatedSkillState | undefined;
    if (!state?.name && !state?.identifier) return undefined;

    const injected = this.findInjectedSkill(state);
    if (!injected?.content) return undefined;

    const original = message.content as string;
    const confirmation = `Skill "${state.name ?? injected.name}" activated. Its full instructions are available in the system prompt.`;

    // The activation result may carry extra sections beyond the injected body
    // (resource tree, project directory hint). When the result is the injected
    // content plus a suffix, keep that suffix — it is not in the system prompt.
    // On any other mismatch (e.g. the skill was edited after activation), drop
    // the stale copy entirely: the system prompt carries the current version.
    const remainder = original.startsWith(injected.content)
      ? original.slice(injected.content.length).trim()
      : '';

    return remainder ? `${confirmation}\n\n${remainder}` : confirmation;
  }
}
