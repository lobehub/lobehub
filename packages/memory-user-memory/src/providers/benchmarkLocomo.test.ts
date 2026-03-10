import { describe, expect, it } from 'vitest';

import { BenchmarkLocomoContextProvider } from './benchmarkLocomo';
import locomoIngestPayloads from './tests/benchmark-locomo-converted.json';

describe('BenchmarkLocomoContextProvider', () => {
  it('should convert LoCoMo ingest payload into benchmark XML context', async () => {
    const sample = locomoIngestPayloads[0];
    const sampleId = sample.sampleId;
    const userId = 'test-user';
    const sourceId = sample.topicId ?? `sample_${sampleId}`;

    let partIndex = 0;
    const parts = sample.sessions.flatMap((session) =>
      session.turns.map((turn) => {
        const createdAt = new Date(turn.createdAt);
        const metadata = {
          diaId: turn.diaId,
          imageCaption: turn.imageCaption,
          imageUrls: turn.imageUrls,
          sessionId: session.sessionId,
        };

        const part = {
          content: turn.text,
          createdAt,
          metadata,
          partIndex,
          sessionId: session.sessionId,
          speaker: turn.speaker,
        };
        partIndex += 1;
        return part;
      }),
    );

    const provider = new BenchmarkLocomoContextProvider({
      parts,
      sampleId,
      sourceId,
      userId,
    });

    const result = await provider.buildContext(userId);

    const { context } = result;
    expect(result.sourceId).toBe(sourceId);
    expect(result.userId).toBe(userId);
    expect(result.metadata).toEqual({});
    expect((context.match(/<message /g) || []).length).toBe(parts.length);
    expect(context).toContain(
      `<benchmark_locomo sample_id="${sampleId}" source_id="${sourceId}" user_id="${userId}">`,
    );
    expect(context).toContain(
      '<message index="0" speaker="Caroline" created_at="2023-05-08T13:56:00.000Z" session_id="session_1">Hey Mel! Good to see you! How have you been?\n[metadata:{"diaId":"D1:1","sessionId":"session_1"}]</message>',
    );
    expect(context).toContain(
      '<message index="4" speaker="Caroline" created_at="2023-05-08T13:56:00.000Z" session_id="session_1">The transgender stories were so inspiring! I was so happy and thankful for all the support.\n[Image: a photo of a dog walking past a wall with a painting of a woman]\n[metadata:{"diaId":"D1:5","imageCaption":"a photo of a dog walking past a wall with a painting of a woman","imageUrls":["https://i.redd.it/l7hozpetnhlb1.jpg"],"sessionId":"session_1"}]</message>',
    );
    expect(context).toContain(
      '<message index="34" speaker="Melanie" created_at="2023-05-25T13:14:00.000Z" session_id="session_2">No doubts, Caroline. You have such a caring heart - they\'ll get all the love and stability they need! Excited for this new chapter!\n[metadata:{"diaId":"D2:17","sessionId":"session_2"}]</message></benchmark_locomo>',
    );
  });
});
