import { MemorySourceType } from '@lobechat/types';
import { convertLocomoFile } from '../../src/converters/locomo';
import { exit } from 'node:process';

const baseUrl = process.env.MEMORY_USER_MEMORY_LOBEHUB_BASE_URL;
const benchmarkLoCoMoFile = process.env.MEMORY_USER_MEMORY_BENCHMARKS_LOCOMO_DATASETS;

const post = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, baseUrl).toString(), {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }

  return res.json();
};

async function main() {
  if (!baseUrl || !benchmarkLoCoMoFile) {
    console.error(
      '[@lobechat/memory-user-memory/benchmarks/locomo] Missing required envs. Set MEMORY_USER_MEMORY_LOBEHUB_BASE_URL and MEMORY_USER_MEMORY_BENCHMARKS_LOCOMO_DATASETS.',
    );

    exit(1);
  }

  console.log(`[@lobechat/memory-user-memory/benchmarks/locomo] loading ${benchmarkLoCoMoFile}`);

  const payloads = convertLocomoFile(benchmarkLoCoMoFile, {
    includeImageCaptions: true,
    source: MemorySourceType.BenchmarkLocomo,
    speakerRoles: { defaultRole: 'user', speakerA: 'user', speakerB: 'assistant' },
    topicIdPrefix: 'sample',
  });

  console.log(
    `[@lobechat/memory-user-memory/benchmarks/locomo] ingesting ${payloads.length} samples to ${baseUrl} (one user per sample)`,
  );

  const usedUserIds = new Set<string>();

  for (const payload of payloads) {
    const userId = `locomo-user-${payload.sampleId}`;
    usedUserIds.add(userId);

    const body = {
      ...payload,
      force: true,
      layers: [], // empty = all layers
      userId,
    };
    try {
      const res = await post('/api/webhooks/memory-extraction/benchmark-locomo', body);
      console.log(`[@lobechat/memory-user-memory/benchmarks/locomo] ingested sample ${payload.sampleId} -> insertedParts=${res.insertedParts ?? 'n/a'} memories=${res.extraction?.memoryIds?.length ?? 0} traceId=${res.extraction?.traceId ?? 'n/a'}`);
    } catch (err) {
      console.error(`[@lobechat/memory-user-memory/benchmarks/locomo] failed sample ${payload.sampleId}`, err);
      break;
    }
  }

  console.log(
    `[@lobechat/memory-user-memory/benchmarks/locomo] users used (${usedUserIds.size}): ${[
      ...usedUserIds,
    ].join(', ')}`,
  );
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((e) => {
  console.error(e);
  exit(1);
});
