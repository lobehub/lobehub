import { BenchmarkLocomoContextProvider } from '@lobechat/memory-user-memory';
import { MemorySourceType } from '@lobechat/types';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { UserMemorySourceBenchmarkLoCoMoModel } from '@/database/models/userMemory/sources/benchmarkLoCoMo';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { MemoryExtractionExecutor } from '@/server/services/memory/userMemory/extract';
import { LayersEnum } from '@/types/userMemory';


const turnSchema = z.object({
  createdAt: z.string(),
  diaId: z.string().optional(),
  imageCaption: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  role: z.string().optional(),
  speaker: z.string(),
  text: z.string(),
});

const sessionSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().optional(),
  turns: z.array(turnSchema),
});

const ingestSchema = z.object({
  force: z.boolean().optional(),
  layers: z.array(z.string()).optional(),
  sampleId: z.string(),
  sessions: z.array(sessionSchema),
  source: z.nativeEnum(MemorySourceType).optional(),
  sourceId: z.string().optional(),
  userId: z.string(),
});

const normalizeLayers = (layers?: string[]) => {
  if (!layers?.length) return [] as LayersEnum[];

  const set = new Set<LayersEnum>();
  layers.forEach((layer) => {
    const normalized = layer.toLowerCase() as LayersEnum;
    if (Object.values(LayersEnum).includes(normalized)) {
      set.add(normalized);
    }
  });

  return Array.from(set);
};

interface SessionExtractionResult {
  extraction?: Awaited<ReturnType<MemoryExtractionExecutor['extractBenchmarkSource']>>;
  insertedParts: number;
  sessionId: string;
  sourceId: string;
}

export const POST = async (req: Request) => {
  try {
    const { webhook } = parseMemoryExtractionConfig();

    if (webhook.headers && Object.keys(webhook.headers).length > 0) {
      for (const [key, value] of Object.entries(webhook.headers)) {
        const headerValue = req.headers.get(key);
        if (headerValue !== value) {
          return NextResponse.json(
            { error: `Unauthorized: Missing or invalid header '${key}'` },
            { status: 403 },
          );
        }
      }
    }

    const json = await req.json();
    const parsed = ingestSchema.parse(json);

    const sourceModel = new UserMemorySourceBenchmarkLoCoMoModel(parsed.userId);
    const baseSourceId = parsed.sourceId || `sample_${parsed.sampleId}`;
    const executor = await MemoryExtractionExecutor.create();
    const layers = normalizeLayers(parsed.layers);

    const results: SessionExtractionResult[] = [];
    const totalInsertedParts = 0;

    await Promise.all(parsed.sessions.map(async (session) => {
      const sessionSourceId = `${baseSourceId}_${session.sessionId}`;

      try {
        await sourceModel.upsertSource({
          id: sessionSourceId,
          metadata: {
            ingestAt: new Date().toISOString(),
            sessionId: session.sessionId,
            sessionTimestamp: session.timestamp,
          },
          sampleId: parsed.sampleId,
          sourceType: (parsed.source ?? MemorySourceType.BenchmarkLocomo) as string,
        });
      } catch (error) {
        console.error(`[locomo-ingest-webhook] upsertSource failed for sourceId=${sessionSourceId}`, error);
        return {
          extraction: undefined,
          insertedParts: 0,
          sessionId: session.sessionId,
          sourceId: sessionSourceId,
        }
      }

      const parts = session.turns.map((turn, index) => {
        const createdAt = new Date(turn.createdAt);
        const metadata: Record<string, unknown> = {
          diaId: turn.diaId,
          imageCaption: turn.imageCaption,
          imageUrls: turn.imageUrls,
          sessionId: session.sessionId,
        };

        return {
          content: turn.text,
          createdAt,
          metadata,
          partIndex: index,
          sessionId: session.sessionId,
          speaker: turn.speaker,
        };
      });

      sourceModel.replaceParts(sessionSourceId, parts);

      const contextProvider = new BenchmarkLocomoContextProvider({
        parts,
        sampleId: parsed.sampleId,
        sourceId: sessionSourceId,
        userId: parsed.userId,
      });

      try {
        const extraction = await executor.extractBenchmarkSource({
          contextProvider,
          forceAll: parsed.force ?? true,
          layers,
          parts,
          source: parsed.source ?? MemorySourceType.BenchmarkLocomo,
          sourceId: sessionSourceId,
          userId: parsed.userId,
        });

        return {
          extraction,
          insertedParts: parts.length,
          sessionId: session.sessionId,
          sourceId: sessionSourceId,
        }
      } catch (error) {
        console.error(`[locomo-ingest-webhook] extractBenchmarkSource failed for sourceId=${sessionSourceId}`, error);
        return {
          extraction: undefined,
          insertedParts: parts.length,
          sessionId: session.sessionId,
          sourceId: sessionSourceId,
        }
      }
    }))

    return NextResponse.json(
      {
        baseSourceId,
        insertedParts: totalInsertedParts,
        results,
        sourceIds: results.map((item) => item.sourceId),
        userId: parsed.userId,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[locomo-ingest-webhook] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
