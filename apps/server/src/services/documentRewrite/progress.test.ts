import { describe, expect, it } from 'vitest';

import { normalizeDocumentRewriteProgress } from '@/database/models/documentRewriteRequest';

describe('document rewrite public progress', () => {
  it('drops raw reasoning fields and bounds events/text', () => {
    const progress = normalizeDocumentRewriteProgress({
      currentStage: 'reading_block',
      events: [
        { at: '2026-09-04T00:00:00.000Z', stage: 'reading_structure' },
        ...Array.from({ length: 40 }, (_, index) => ({
          at: `2026-09-04T00:01:${String(index).padStart(2, '0')}.000Z`,
          stage: 'generating_replacement',
        })),
        {
          at: '2026-09-04T00:02:00.000Z',
          detail: 'd'.repeat(500),
          reasoning_delta: 'PRIVATE_CHAIN_OF_THOUGHT',
          stage: 'reading_block',
          summary: 's'.repeat(800),
          tool: 'read_document_block',
        },
      ],
      reasoning_delta: 'PRIVATE_CHAIN_OF_THOUGHT',
      summary: 'public summary',
      updatedAt: '2026-09-04T00:01:40.000Z',
    });

    expect(progress).not.toBeNull();
    expect(progress?.events).toHaveLength(32);
    expect(progress?.events.at(-1)?.stage).toBe('reading_block');
    expect(
      progress?.events.find((event) => event.tool === 'read_document_block')?.detail,
    ).toHaveLength(160);
    expect(
      progress?.events.find((event) => event.tool === 'read_document_block')?.summary,
    ).toHaveLength(512);
    expect(JSON.stringify(progress)).not.toContain('PRIVATE_CHAIN_OF_THOUGHT');
    expect(JSON.stringify(progress)).not.toContain('reasoning_delta');
  });

  it('rejects unknown stages and tools instead of exposing provider payloads', () => {
    expect(
      normalizeDocumentRewriteProgress({
        currentStage: 'thinking_delta',
        events: [
          {
            at: '2026-09-04T00:00:00.000Z',
            stage: 'thinking_delta',
            tool: 'unknown-provider-tool',
          },
        ],
        updatedAt: '2026-09-04T00:00:00.000Z',
      }),
    ).toBeNull();
  });
});
