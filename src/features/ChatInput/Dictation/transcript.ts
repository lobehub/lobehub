import { type RealtimeAsrServerEvent } from './contract';

export interface DictationTextSnapshot {
  anchor: number;
  committed: string;
  partial: string;
  prefix: string;
  sessionId: string;
  suffix: string;
  text: string;
}

export interface DictationEventResult {
  accepted: boolean;
  changed: boolean;
}

export class DictationTranscript {
  readonly #anchor: number;
  readonly #committedSegmentIds = new Set<string>();
  readonly #prefix: string;
  readonly #sessionId: string;
  readonly #suffix: string;
  #committed = '';
  #currentSegmentId?: string;
  #lastSequence = 0;
  #partial = '';

  constructor(options: { anchor: number; prefix: string; sessionId: string; suffix: string }) {
    this.#anchor = options.anchor;
    this.#prefix = options.prefix;
    this.#sessionId = options.sessionId;
    this.#suffix = options.suffix;
  }

  get dictatedText() {
    return this.#committed + this.#partial;
  }

  get snapshot(): DictationTextSnapshot {
    return {
      anchor: this.#anchor,
      committed: this.#committed,
      partial: this.#partial,
      prefix: this.#prefix,
      sessionId: this.#sessionId,
      suffix: this.#suffix,
      text: this.#prefix + this.dictatedText + this.#suffix,
    };
  }

  accept(event: RealtimeAsrServerEvent): DictationEventResult {
    if (event.sessionId !== this.#sessionId || event.sequence <= this.#lastSequence) {
      return { accepted: false, changed: false };
    }

    this.#lastSequence = event.sequence;
    if (event.type !== 'transcript.partial' && event.type !== 'transcript.final') {
      return { accepted: true, changed: false };
    }

    if (this.#committedSegmentIds.has(event.segmentId)) {
      return { accepted: false, changed: false };
    }

    if (event.type === 'transcript.partial') {
      if (this.#currentSegmentId && this.#currentSegmentId !== event.segmentId) {
        return { accepted: false, changed: false };
      }

      const changed = this.#partial !== event.text;
      this.#currentSegmentId = event.segmentId;
      this.#partial = event.text;
      return { accepted: true, changed };
    }

    if (this.#currentSegmentId && this.#currentSegmentId !== event.segmentId) {
      return { accepted: false, changed: false };
    }

    this.#committed += event.text;
    this.#partial = '';
    this.#currentSegmentId = undefined;
    this.#committedSegmentIds.add(event.segmentId);
    return { accepted: true, changed: true };
  }

  discardPartial() {
    const changed = this.#partial.length > 0;
    this.#partial = '';
    this.#currentSegmentId = undefined;
    return changed;
  }
}
