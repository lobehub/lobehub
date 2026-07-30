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
 * output at all: no content (empty or `LOADING_FLAT`), no tool calls, and no
 * reasoning text. Failed messages that carry partial content are kept —
 * intentionally added assistant messages (prefill) always carry content, so
 * they are never touched.
 */
export class PlaceholderMessageFilterProcessor extends BaseProcessor {
  readonly name = 'PlaceholderMessageFilterProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const before = clonedContext.messages.length;
    clonedContext.messages = clonedContext.messages.filter(
      (message) => !this.isPlaceholderResidue(message),
    );
    const removedCount = before - clonedContext.messages.length;

    clonedContext.metadata.placeholderMessageFilter = { removedCount };

    if (removedCount > 0) {
      log(`Removed ${removedCount} assistant placeholder residue message(s)`);
    }

    return this.markAsExecuted(clonedContext);
  }

  private isPlaceholderResidue(message: any): boolean {
    if (message.role !== 'assistant') return false;

    // Any tool call means the step produced real work — keep it.
    if (Array.isArray(message.tools) && message.tools.length > 0) return false;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;

    // Real reasoning text is meaningful output even without content.
    if (message.reasoning?.content) return false;

    // Non-string content (multimodal parts) is meaningful output.
    if (typeof message.content !== 'string') return message.content == null;

    const content = message.content.trim();
    return content === '' || content === LOADING_FLAT;
  }
}
