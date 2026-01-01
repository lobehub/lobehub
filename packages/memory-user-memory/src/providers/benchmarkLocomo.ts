import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import type { Child } from 'xastscript';
import { x } from 'xastscript';

import type { BuiltContext, MemoryContextProvider, MemoryExtractionJob } from '../types';

export interface BenchmarkLocomoPart {
  content: string;
  createdAt?: string | Date;
  metadata?: Record<string, unknown> | null;
  partIndex: number;
  sessionId?: string | null;
  speaker?: string | null;
}

export interface BenchmarkLocomoContextProviderOptions {
  parts: BenchmarkLocomoPart[];
  sampleId: string;
  sourceId: string;
  userId: string;
}

export class BenchmarkLocomoContextProvider
  implements MemoryContextProvider<Record<string, unknown>, Record<string, unknown>>
{
  private readonly options: BenchmarkLocomoContextProviderOptions;

  constructor(options: BenchmarkLocomoContextProviderOptions) {
    this.options = options;
  }

  private buildMessageNode(part: BenchmarkLocomoPart, index: number) {
    const attributes: Record<string, string> = { index: index.toString() };

    if (part.speaker) attributes.speaker = part.speaker;
    if (part.createdAt) attributes.created_at = new Date(part.createdAt).toISOString();
    if (part.sessionId) attributes.session_id = part.sessionId;

    const metadata = part.metadata ? JSON.stringify(part.metadata) : undefined;

    return x('message', attributes, part.content, metadata ? `\n[metadata:${metadata}]` : '');
  }

  async buildContext(job: MemoryExtractionJob): Promise<BuiltContext<Record<string, unknown>>> {
    const messageChildren: Child[] = this.options.parts.map((part, index) =>
      this.buildMessageNode(part, index),
    );

    const root = u('root', [
      x(
        'benchmark_locomo',
        {
          sample_id: this.options.sampleId,
          source_id: this.options.sourceId,
          user_id: this.options.userId,
        },
        ...messageChildren,
      ),
    ]);

    return {
      context: toXml(root),
      metadata: {},
      sourceId: this.options.sourceId,
      userId: job.userId,
    };
  }
}
