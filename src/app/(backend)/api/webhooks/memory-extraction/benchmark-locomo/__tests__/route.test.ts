import { beforeEach, describe, expect, it, vi } from 'vitest';

const replaceParts = vi.fn();
const upsertSource = vi.fn();
const extractBenchmarkSource = vi.fn();

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({ webhook: { headers: {} } }),
}));

vi.mock('@/database/models/userMemory/sources/benchmarkLoCoMo', () => ({
  UserMemorySourceBenchmarkLoCoMoModel: vi.fn().mockImplementation(() => ({
    replaceParts,
    upsertSource,
  })),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionExecutor: {
    create: vi.fn(async () => ({
      extractBenchmarkSource,
    })),
  },
}));

vi.mock('@lobechat/memory-user-memory', () => ({
  BenchmarkLocomoContextProvider: vi.fn().mockImplementation((params) => params),
}));

describe('benchmark LoCoMo memory extraction webhook', () => {
  beforeEach(() => {
    replaceParts.mockReset();
    upsertSource.mockReset();
    extractBenchmarkSource.mockReset();

    upsertSource.mockResolvedValue({ id: 'source-id' });
    extractBenchmarkSource.mockImplementation(async ({ sourceId }) => ({
      layers: {},
      memoryIds: [`memory-${sourceId}`],
      traceId: `trace-${sourceId}`,
    }));
  });

  it('returns per-session ingestion results and inserted part count', async () => {
    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/webhooks/memory-extraction/benchmark-locomo', {
        body: JSON.stringify({
          sampleId: 'conv-26',
          sessions: [
            {
              sessionId: 'session_1',
              timestamp: '2023-05-08T13:56:00.000Z',
              turns: [
                {
                  createdAt: '2023-05-08T13:56:00.000Z',
                  diaId: 'D1:1',
                  speaker: 'Caroline',
                  text: 'Hey Mel!',
                },
                {
                  createdAt: '2023-05-08T13:56:00.000Z',
                  diaId: 'D1:2',
                  speaker: 'Melanie',
                  text: 'Hi Caroline!',
                },
              ],
            },
            {
              sessionId: 'session_2',
              timestamp: '2023-05-25T13:14:00.000Z',
              turns: [
                {
                  createdAt: '2023-05-25T13:14:00.000Z',
                  diaId: 'D2:1',
                  speaker: 'Caroline',
                  text: 'I am researching adoption agencies.',
                },
              ],
            },
          ],
          userId: 'locomo-user-conv-26',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.insertedParts).toBe(3);
    expect(json.sourceIds).toEqual([
      'sample_conv-26_session_1',
      'sample_conv-26_session_2',
    ]);
    expect(json.results).toHaveLength(2);
    expect(json.results[0]).toMatchObject({
      insertedParts: 2,
      sessionId: 'session_1',
      sourceId: 'sample_conv-26_session_1',
    });
    expect(json.results[1]).toMatchObject({
      insertedParts: 1,
      sessionId: 'session_2',
      sourceId: 'sample_conv-26_session_2',
    });
    expect(replaceParts).toHaveBeenCalledTimes(2);
    expect(extractBenchmarkSource).toHaveBeenCalledTimes(2);
  });
});
