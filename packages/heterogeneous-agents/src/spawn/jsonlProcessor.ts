/**
 * Parses stdout as JSONL / NDJSON while tolerating non-JSON noise lines.
 * Different CLIs still end up sharing this framing logic even when the
 * payload schema differs.
 */
export class JsonlStreamProcessor {
  private buffer = '';

  push(chunk: Buffer | string): unknown[] {
    this.buffer += chunk instanceof Buffer ? chunk.toString('utf8') : chunk;
    return this.drainCompleteLines();
  }

  flush(): unknown[] {
    const trailing = this.buffer.trim();
    this.buffer = '';

    if (!trailing) return [];

    try {
      return [JSON.parse(trailing)];
    } catch {
      return [];
    }
  }

  private drainCompleteLines(): unknown[] {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    const parsed: unknown[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        parsed.push(JSON.parse(trimmed));
      } catch {
        // Ignore non-JSON stdout noise.
      }
    }

    return parsed;
  }
}
