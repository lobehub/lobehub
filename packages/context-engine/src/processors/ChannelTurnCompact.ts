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
 * The envelope a Channel prompt ends with: its request, or the wake hint after it. Every block of
 * one prompt carries the run's random boundary, chosen so it appears in no participant's text.
 */
const ENVELOPE_END = /<\/channel_(?:request|wake) boundary="([\da-z]+)">$/;

/**
 * The request block of a whole Channel prompt, or `undefined` when the message is not one.
 *
 * The boundary is read from the envelope, the closing tag the message ends with, and the message
 * must also open with a Channel block under it. Only the request under that boundary counts: a
 * `channel_request` pair a participant wrote inside a quoted or recent message carries another
 * boundary (or none) and is never taken for the real one.
 */
export const extractChannelRequest = (content: string): string | undefined => {
  const text = content.trimEnd();
  const boundary = ENVELOPE_END.exec(text)?.[1];
  if (!boundary) return;

  // The boundary is lowercase hex, so it is safe inside a pattern as it is.
  const attribute = String.raw`\bboundary="${boundary}"`;
  if (!new RegExp(String.raw`^<channel_[a-z]+\b[^>]*${attribute}[^>]*>\n`).test(text)) return;

  const opening = new RegExp(String.raw`<channel_request\b[^>]*${attribute}[^>]*>\n`, 'g');
  let start = -1;
  for (const match of text.matchAll(opening)) start = match.index;
  if (start < 0) return;

  const closing = `\n</channel_request boundary="${boundary}">`;
  const end = text.indexOf(closing, start);
  return end < 0 ? undefined : text.slice(start, end + closing.length);
};

export interface ChannelTurnCompactConfig {
  /**
   * Only a Channel run's history is made of Channel prompts; the engine turns this on for those
   * runs alone, so no other conversation is ever compacted.
   * @default false
   */
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
 * compacted, so the prompt prefix changes only where a new turn begins. It runs only for Channel
 * runs, and only on messages that are whole Channel prompts (see {@link extractChannelRequest}).
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
    if (this.config.enabled !== true) return this.markAsExecuted(context);

    const lastUser = context.messages.findLastIndex((message) => message.role === 'user');
    if (lastUser <= 0) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    let compactedMessages = 0;
    let savedChars = 0;
    for (let index = 0; index < lastUser; index++) {
      const message = clonedContext.messages[index];
      if (message.role !== 'user' || typeof message.content !== 'string') continue;

      const request = extractChannelRequest(message.content);
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
