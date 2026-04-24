import type { HeterogeneousAgentParsedOutput, HeterogeneousAgentStreamProcessor } from './types';

export interface JsonlProcessorOptions {
  extractSessionId?: (payload: any) => string | undefined;
}

/**
 * Parses stdout as JSONL / NDJSON while tolerating non-JSON noise lines.
 * Different CLIs still end up sharing this framing logic even when the
 * payload schema differs.
 */
export class JsonlStreamProcessor implements HeterogeneousAgentStreamProcessor {
  private buffer = '';

  constructor(private readonly options: JsonlProcessorOptions = {}) {}

  push(chunk: Buffer | string): HeterogeneousAgentParsedOutput[] {
    this.buffer += chunk instanceof Buffer ? chunk.toString('utf8') : chunk;
    return this.drainCompleteLines();
  }

  flush(): HeterogeneousAgentParsedOutput[] {
    const trailing = this.buffer.trim();
    this.buffer = '';

    if (!trailing) return [];

    try {
      return [this.toParsedOutput(JSON.parse(trailing))];
    } catch {
      return [];
    }
  }

  private drainCompleteLines(): HeterogeneousAgentParsedOutput[] {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    const parsed: HeterogeneousAgentParsedOutput[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        parsed.push(this.toParsedOutput(JSON.parse(trimmed)));
      } catch {
        // Ignore non-JSON stdout noise.
      }
    }

    return parsed;
  }

  private toParsedOutput(payload: any): HeterogeneousAgentParsedOutput {
    return {
      agentSessionId: this.options.extractSessionId?.(payload),
      payload,
    };
  }
}
