import { LOADING_FLAT } from '@lobechat/const';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    placeholderMessageFilter?: {
      removedCount: number;
    };
  }
}

const log = debug('context-engine:processor:PlaceholderMessageFilterProcessor');

/**
 * Placeholder Message Filter Processor
 *
 * Removes assistant placeholder residue from the context. When a generation
 * fails or is abandoned mid-flight, its optimistic assistant row can stay
 * persisted with the `LOADING_FLAT` placeholder content (with or without an
 * `error` — a crashed run never writes one). Replaying these rows poisons the
 * conversation: they carry zero information for the model, and once one lands
 * at the tail of the payload, Claude 4.6+ rejects the whole request as an
 * unsupported assistant prefill (400), which persists yet another placeholder
 * and makes the topic permanently unsendable.
 *
 * A message is treated as placeholder residue only when it has no meaningful
 * output at all: no content (empty or `LOADING_FLAT`), no tool-call fields, no
 * reasoning text, and no multimodal attachments (image/video/audio/file lists,
 * which legitimately pair with an empty text content). Failed messages that
 * carry partial content are kept — intentionally added assistant messages
 * (prefill) always carry content, so they are never touched.
 *
 * `tools` / `tool_calls` are checked for PRESENCE (any array, even empty), not
 * length: placeholder rows are persisted with these fields unset, while the
 * long-standing pipeline contract keeps an empty-content assistant whose
 * `tool_calls: []` field exists (see contextEngineering "empty tool calls"
 * test).
 *
 * Residue hiding inside group/tasks containers is pruned too (and a container
 * left empty is dropped), so a placeholder-only container cannot consume a
 * history-truncation slot before the flatten phase erases it.
 */
export class PlaceholderMessageFilterProcessor extends BaseProcessor {
  readonly name = 'PlaceholderMessageFilterProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  /** Container roles whose child arrays can hide placeholder residue */
  private static readonly NESTED_CHILD_FIELDS: Record<string, string> = {
    agentCouncil: 'members',
    assistantGroup: 'children',
    groupTasks: 'tasks',
    supervisor: 'children',
    tasks: 'tasks',
  };

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Prune residue nested inside group/tasks containers first: it must go
    // BEFORE history truncation, where each container counts as one history
    // group — a placeholder-only container would consume a slot and then
    // vanish at the flatten phase, silently shrinking the real history.
    let removedCount = 0;
    clonedContext.messages = clonedContext.messages
      .map((message) => {
        const pruned = this.pruneContainerResidue(message);
        removedCount += pruned.removedChildren;
        return pruned.message;
      })
      .filter((message): message is NonNullable<typeof message> => message !== null);

    const before = clonedContext.messages.length;
    clonedContext.messages = clonedContext.messages.filter(
      (message) => !this.isPlaceholderResidue(message),
    );
    removedCount += before - clonedContext.messages.length;

    // The processor runs twice in the pipeline (top-level pass + post-flatten
    // pass for residue expanded out of group children) — accumulate the count.
    const priorRemovedCount = clonedContext.metadata.placeholderMessageFilter?.removedCount ?? 0;
    clonedContext.metadata.placeholderMessageFilter = {
      removedCount: priorRemovedCount + removedCount,
    };

    if (removedCount > 0) {
      log(`Removed ${removedCount} assistant placeholder residue message(s)`);
    }

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Remove placeholder residue from a container message's child array
   * (tasks/groupTasks → `tasks`, assistantGroup/supervisor → `children`).
   * Returns the container with residue children removed, or `null` when every
   * child was residue (an empty container flattens to nothing anyway, but
   * left in place it would still consume a history-truncation slot).
   */
  private pruneContainerResidue(message: any): { message: any | null; removedChildren: number } {
    const field = (PlaceholderMessageFilterProcessor.NESTED_CHILD_FIELDS as any)[message.role];
    const children = field ? message[field] : undefined;
    if (!Array.isArray(children) || children.length === 0) return { message, removedChildren: 0 };

    let removedChildren = 0;
    const kept: any[] = [];
    for (const child of children) {
      // Containers nest (an agentCouncil member can be an assistantGroup) —
      // recurse first so an all-residue nested container is dropped too.
      const prunedChild = this.pruneContainerResidue(child);
      removedChildren += prunedChild.removedChildren;
      if (prunedChild.message === null) continue;

      // Only judge assistant-like children; tool/user children inside a group
      // are legitimately empty-content and must never be dropped here. Task
      // children have no role until TasksFlatten assigns 'task'.
      const role = prunedChild.message.role ?? 'assistant';
      if (
        (role === 'assistant' || role === 'task') &&
        this.isPlaceholderResidue({ ...prunedChild.message, role: 'assistant' })
      ) {
        removedChildren += 1;
        continue;
      }

      kept.push(prunedChild.message);
    }

    if (removedChildren === 0) return { message, removedChildren: 0 };
    if (kept.length === 0) return { message: null, removedChildren: removedChildren + 1 };

    return { message: { ...message, [field]: kept }, removedChildren };
  }

  private isPlaceholderResidue(message: any): boolean {
    if (message.role !== 'assistant') return false;

    // Presence of a tool-call field (even an empty array) means the row went
    // through the tool pipeline, not the placeholder path — keep it.
    if (Array.isArray(message.tools)) return false;
    if (Array.isArray(message.tool_calls)) return false;

    // Any replayable reasoning payload is meaningful output even without
    // content: visible text, an encrypted signature, or Responses reasoning
    // items (a thinking run can finish with hidden reasoning state only,
    // which the next request must replay).
    if (
      message.reasoning?.content ||
      message.reasoning?.signature ||
      message.reasoning?.responseItems?.length > 0
    )
      return false;

    // Multimodal attachments legitimately pair with an empty text content
    // (e.g. an image-only assistant reply) — keep them.
    if (message.imageList?.length > 0) return false;
    if (message.videoList?.length > 0) return false;
    if (message.audioList?.length > 0) return false;
    if (message.fileList?.length > 0) return false;

    // Non-string content (multimodal parts) is meaningful output.
    if (typeof message.content !== 'string') return message.content == null;

    const content = message.content.trim();
    return content === '' || content === LOADING_FLAT;
  }
}
