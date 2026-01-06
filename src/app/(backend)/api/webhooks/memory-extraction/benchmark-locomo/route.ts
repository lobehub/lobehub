import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MemorySourceType } from '@lobechat/types';
import { BenchmarkLocomoContextProvider } from '@lobechat/memory-user-memory';
import { UserMemorySourceBenchmarkLoCoMoModel } from '@/database/models/userMemory/sources/benchmarkLoCoMo';
import { MemoryExtractionExecutor } from '@/server/services/memory/userMemory/extract';
import { LayersEnum } from '@/types/userMemory';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';


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

export const POST = async (req: Request) => {
  try {
    const { webhookHeaders } = parseMemoryExtractionConfig();

    if (webhookHeaders && Object.keys(webhookHeaders).length > 0) {
      for (const [key, value] of Object.entries(webhookHeaders)) {
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

    const sourceId = parsed.sourceId || `sample_${parsed.sampleId}`;
    await sourceModel.upsertSource({
      id: sourceId,
      metadata: { ingestAt: new Date().toISOString() },
      sampleId: parsed.sampleId,
      sourceType: (parsed.source ?? MemorySourceType.BenchmarkLocomo) as string,
    });

    let partCounter = 0;
    const parts = parsed.sessions.flatMap((session) => {
      return session.turns.map((turn) => {
        const createdAt = new Date(turn.createdAt);
        const metadata: Record<string, unknown> = {
          diaId: turn.diaId,
          imageCaption: turn.imageCaption,
          imageUrls: turn.imageUrls,
          sessionId: session.sessionId,
        };

        const part = {
          content: turn.text,
          createdAt,
          metadata,
          partIndex: partCounter,
          sessionId: session.sessionId,
          speaker: turn.speaker,
        };
        partCounter += 1;
        return part;
      });
    });

    await sourceModel.replaceParts(sourceId, parts);

    const contextProvider = new BenchmarkLocomoContextProvider({
      parts,
      sampleId: parsed.sampleId,
      sourceId,
      userId: parsed.userId,
    });

    const executor = await MemoryExtractionExecutor.create();
    const layers = normalizeLayers(parsed.layers);
    const extraction = await executor.extractBenchmarkSource({
      contextProvider,
      forceAll: parsed.force ?? true,
      layers,
      parts,
      source: parsed.source ?? MemorySourceType.BenchmarkLocomo,
      sourceId,
      userId: parsed.userId,
    });

    return NextResponse.json(
      {
        extraction,
        insertedParts: parts.length,
        sourceId,
        userId: parsed.userId,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[locomo-ingest-webhook] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
