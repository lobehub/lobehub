import {
  DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
} from '@lobechat/const';
import { ModelRuntime } from '@lobechat/model-runtime';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { UserMemoryModel } from '@/database/models/userMemory/model';
import { userMemories } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { selectNonVectorColumns } from '@/database/utils/columns';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { LayersEnum } from '@/types/userMemory';

const bodySchema = z.object({
  layer: z.nativeEnum(LayersEnum).optional(),
  query: z.string().min(1),
  sampleId: z.string().optional(),
  topK: z.coerce.number().int().positive().max(50).optional(),
  userId: z.string().optional(),
});

export const POST = async (req: Request) => {
  const { webhook, featureFlags } = parseMemoryExtractionConfig();
  if (!featureFlags.enableBenchmarkLoCoMo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (webhook?.headers && Object.keys(webhook?.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook?.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const json = await req.json();
    const parsed = bodySchema.parse(json);

    console.log('[locomo-dev-search] parsed body', parsed);
    const userId = parsed.userId || (parsed.sampleId ? `locomo-user-${parsed.sampleId}` : undefined);
    if (!userId) {
      return NextResponse.json({ error: 'userId or sampleId is required' }, { status: 400 });
    }

    const topK = parsed.topK ?? 5;

    const db = await getServerDB();
    const model = new UserMemoryModel(db, userId);
    const config = parseMemoryExtractionConfig();

    const runtime = await ModelRuntime.initializeWithProvider(
      DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.provider,
      {
        apiKey: config.embedding.apiKey,
        baseURL: config.embedding.baseURL,
      },
    );

    const [embedding] =
    (await runtime.embeddings({
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: parsed.query,
      model: config.embedding.model,
    })) || [];

    if (!embedding) {
      return NextResponse.json(
        { error: 'Failed to generate embedding for query' },
        { status: 500 },
      );
    }
    console.log('[locomo-dev-search] generated embedding');

    const searchResult = await model.searchWithEmbedding({
      embedding,
      limits: {
        activities: topK,
        contexts: topK,
        experiences: topK,
        preferences: topK,
      },
    });
    console.log('[locomo-dev-search] searched result');

    const identities = await model.getAllIdentities();
    console.log('[locomo-dev-search] fetched identities');

    const memoryIds = [
      ...searchResult.contexts
        .map((context) => Array.isArray(context.userMemoryIds) ? (context.userMemoryIds as string[])[0] : undefined)
        .filter((id): id is string => !!id),
      ...searchResult.experiences
        .map((experience) => experience.userMemoryId)
        .filter((id): id is string => !!id),
      ...searchResult.preferences
        .map((preference) => preference.userMemoryId)
        .filter((id): id is string => !!id),
      ...searchResult.activities
        .map((activity) => activity.userMemoryId)
        .filter((id): id is string => !!id),
      ...identities
        .map((identity) => identity.userMemoryId)
        .filter((id): id is string => !!id),
    ];

    const uniqueMemoryIds = Array.from(new Set(memoryIds));

    const memories =
      uniqueMemoryIds.length === 0
        ? []
        : await db
          .select(selectNonVectorColumns(userMemories))
          .from(userMemories)
          .where(and(eq(userMemories.userId, userId), inArray(userMemories.id, uniqueMemoryIds)));
    console.log('[locomo-dev-search] fetched memories');

    const memoryMap = new Map(memories.map((memory) => [memory.id, memory]));

    const contextItems = searchResult.contexts
      .map((context) => {
        const memoryId = Array.isArray(context.userMemoryIds)
          ? (context.userMemoryIds as string[])[0]
          : undefined;
        const memory = memoryId ? memoryMap.get(memoryId) : undefined;
        if (!memory) return undefined;

        return {
          context,
          id: memory.id,
          layer: LayersEnum.Context,
          memory,
        };
      })
      .filter(Boolean);

    const experienceItems = searchResult.experiences
      .map((experience) => {
        const memory = experience.userMemoryId ? memoryMap.get(experience.userMemoryId) : undefined;
        if (!memory) return undefined;

        return {
          experience,
          id: experience.userMemoryId,
          layer: LayersEnum.Experience,
          memory,
        };
      })
      .filter(Boolean);

    const preferenceItems = searchResult.preferences
      .map((preference) => {
        const memory = preference.userMemoryId ? memoryMap.get(preference.userMemoryId) : undefined;
        if (!memory) return undefined;

        return {
          id: preference.userMemoryId,
          layer: LayersEnum.Preference,
          memory,
          preference,
        };
      })
      .filter(Boolean);

    const identityItems = identities
      .map((identity) => {
        const memory = identity.userMemoryId ? memoryMap.get(identity.userMemoryId) : undefined;
        if (!memory) return undefined;

        return {
          id: identity.userMemoryId,
          identity,
          layer: LayersEnum.Identity,
          memory,
        };
      })
      .filter(Boolean);

    const activityItems = searchResult.activities
      .map((activity) => {
        const memory = activity.userMemoryId ? memoryMap.get(activity.userMemoryId) : undefined;
        if (!memory) return undefined;

        return {
          activity,
          id: activity.userMemoryId,
          layer: LayersEnum.Activity,
          memory,
        };
      })
      .filter(Boolean);

    const items = [
      ...contextItems.slice(0, topK),
      ...experienceItems.slice(0, topK),
      ...preferenceItems.slice(0, topK),
      ...activityItems.slice(0, topK),
      ...identityItems,
    ];
    console.log('[locomo-dev-search] compiled items');

    return NextResponse.json({
      items,
      total: items.length,
      userId,
    });
  } catch (error) {
    console.error('[locomo-dev-search] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
