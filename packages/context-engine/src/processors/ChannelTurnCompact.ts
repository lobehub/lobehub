import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    channelTurnCompact?: { compactedMessages: number; savedChars: number };
  }
}

const log = debug('context-engine:processor:ChannelTurnCompactProcessor');

/**
 * A Channel run's request block. The closing tag repeats the run's random boundary, which no
 * participant can write in advance, so a match is the prompt the Channel built, never text a
 * person typed.
 */
const CHANNEL_REQUEST =
  /<channel_request\b[^>]*\bboundary="([\da-z]+)"[^>]*>\n[\S\s]*?\n<\/channel_request boundary="\1">/;

export interface ChannelTurnCompactConfig {
  /** @default true */
  enabled?: boolean;
}

/**
 * Keeps only the request of each earlier Channel turn.
 *
 * Every Channel run's user message carries, besides its `channel_request`, the public messages
 * the topic had not seen, an explicit quote and the wake hint. They are context for that turn
 * only: the topic answered them, the history tools re-read them, and kept verbatim they pile up
 * turn after turn. An earlier user message that holds a Channel request is reduced to that
 * request block; the latest user message (the one being answered) is left untouched.
 *
 * Deterministic and monotone: a turn is compacted once it is no longer the latest and stays
 * compacted, so the prompt prefix changes only where a new turn begins. Messages that are not
 * Channel prompts are never touched, so bot and ordinary chats are unaffected.
 */
export class ChannelTurnCompactProcessor extends BaseProcessor {
  readonly name = 'ChannelTurnCompactProcessor';

  constructor(
    private config: ChannelTurnCompactConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const lastUser = context.messages.findLastIndex((message) => message.role === 'user');
    if (lastUser <= 0) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    let compactedMessages = 0;
    let savedChars = 0;
    for (let index = 0; index < lastUser; index++) {
      const message = clonedContext.messages[index];
      if (message.role !== 'user' || typeof message.content !== 'string') continue;

      const request = CHANNEL_REQUEST.exec(message.content)?.[0];
      if (!request || request.length === message.content.length) continue;

      savedChars += message.content.length - request.length;
      compactedMessages += 1;
      clonedContext.messages[index] = { ...message, content: request };
    }

    if (compactedMessages) {
      clonedContext.metadata.channelTurnCompact = { compactedMessages, savedChars };
      log('compacted %d Channel turns, saved %d chars', compactedMessages, savedChars);
    }

    return this.markAsExecuted(clonedContext);
  }
}
