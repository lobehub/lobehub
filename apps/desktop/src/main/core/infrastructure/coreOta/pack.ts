import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

import type { CoreManifestV4, PackFrame } from './manifest';
import { sha256File } from './manifest';

const decompress = promisify(zstdDecompress);
const CONCURRENCY = 8;
const MAX_RANGE = 16 * 1024 ** 2;

interface Transfer extends PackFrame {
  fromSha256?: string;
  toSha256: string;
}
interface Range {
  end: number;
  frames: Transfer[];
  offset: number;
  packSha256: string;
}
interface Timing {
  bytesPerSecond: number;
  latency: number;
}
// ponytail: cold-start estimates, replace with measured defaults when deployment benchmarks exist.
const COLD_TIMING: Timing = { bytesPerSecond: 4 * 1024 ** 2, latency: 0.15 };

const cost = (ranges: Range[], timing: Timing) =>
  ranges.reduce((sum, range) => sum + range.end - range.offset, 0) / timing.bytesPerSecond +
  Math.ceil(ranges.length / CONCURRENCY) * timing.latency;

export function planPackDownload(
  manifest: CoreManifestV4,
  missing: string[],
  local: Map<string, string>,
  timing = COLD_TIMING,
): { full: boolean; ranges: Range[] } {
  if (!missing.length) return { full: false, ranges: [] };
  const objects = missing.map((toSha256) => ({ ...manifest.objects[toSha256], toSha256 }));
  const patches = new Map<string, Transfer>();
  for (const patch of manifest.patches) {
    if (
      local.has(patch.fromSha256) &&
      patch.length <
        (patches.get(patch.toSha256)?.length ?? manifest.objects[patch.toSha256].length)
    )
      patches.set(patch.toSha256, patch);
  }
  const merge = (frames: Transfer[]) => {
    const ranges: Range[] = [];
    for (const frame of frames.sort(
      (a, b) => a.packSha256.localeCompare(b.packSha256) || a.offset - b.offset,
    )) {
      const last = ranges.at(-1);
      const end = frame.offset + frame.length;
      const gap = last ? frame.offset - last.end : Infinity;
      if (
        last?.packSha256 === frame.packSha256 &&
        end - last.offset <= MAX_RANGE &&
        gap <= (timing.bytesPerSecond * timing.latency) / CONCURRENCY
      ) {
        last.end = end;
        last.frames.push(frame);
      } else
        ranges.push({ end, frames: [frame], offset: frame.offset, packSha256: frame.packSha256 });
    }
    return ranges;
  };
  const candidates = [
    { full: false, ranges: merge([...objects]) },
    { full: false, ranges: merge(objects.map((frame) => patches.get(frame.toSha256) ?? frame)) },
    {
      full: true,
      ranges: [
        {
          end: manifest.packs.find((pack) => pack.sha256 === objects[0].packSha256)!.size,
          frames: objects,
          offset: 0,
          packSha256: objects[0].packSha256,
        },
      ],
    },
  ];
  return candidates.sort(
    (a, b) => cost(a.ranges, timing) - cost(b.ranges, timing) || Number(b.full) - Number(a.full),
  )[0];
}

export type PackFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class PackDownloader {
  private timing = COLD_TIMING;

  constructor(private readonly fetchImpl: PackFetch) {}

  async download(
    manifest: CoreManifestV4,
    missing: string[],
    local: Map<string, string>,
    baseUrl: string,
    put: (sha256: string, content: Buffer) => Promise<void>,
  ) {
    const plan = planPackDownload(manifest, missing, local, this.timing);
    const downloaded = { bytes: 0, objects: 0, patches: 0 };
    if (!missing.length) return { downloaded, fallbackFull: false };
    const temp = await mkdtemp(path.join(tmpdir(), 'core-pack-'));
    const packs = new Map(manifest.packs.map((pack) => [pack.sha256, pack]));
    const sizes = new Map(manifest.tree.map((file) => [file.sha256, file.size]));
    const fullDownloads = new Map<string, Promise<string>>();
    const failedPatches = new Set<string>();
    let serial = 0;
    let usedFull = plan.full;

    const save = async (response: Response, expected: number, packHash?: string) => {
      const filename = path.join(temp, String(serial++));
      const file = await open(filename, 'wx', 0o600);
      const digest = createHash('sha256');
      const reader = response.body?.getReader();
      let received = 0;
      try {
        if (!reader) throw new Error('Missing pack response body');
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) !== expected)
          throw new Error('Pack Content-Length mismatch');
        if (
          response.headers.get('content-encoding') &&
          response.headers.get('content-encoding') !== 'identity'
        )
          throw new Error('Encoded pack response');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          downloaded.bytes += value.byteLength;
          if (received > expected) throw new Error('Oversized pack response');
          digest.update(value);
          let offset = 0;
          while (offset < value.length) {
            const { bytesWritten } = await file.write(value, offset, value.length - offset);
            if (!bytesWritten) throw new Error('Pack write stalled');
            offset += bytesWritten;
          }
        }
        if (received !== expected) throw new Error('Truncated pack response');
        if (packHash && digest.digest('hex') !== packHash) throw new Error('Pack hash mismatch');
        return filename;
      } finally {
        await reader?.cancel().catch(() => {});
        await file.close();
      }
    };
    const fetchRange = async (
      range: Range,
      full: boolean,
    ): Promise<{ file: string; start: number }> => {
      const pack = packs.get(range.packSha256)!;
      const url = `${baseUrl}/${pack.path}`;
      const getFull = () => {
        if (!fullDownloads.has(pack.sha256))
          fullDownloads.set(
            pack.sha256,
            (async () => {
              usedFull = true;
              const response = await this.fetchImpl(url);
              if (response.status !== 200) {
                await response.body?.cancel();
                throw new Error(`Pack HTTP ${response.status}`);
              }
              return save(response, pack.size, pack.sha256);
            })().catch((error) => {
              fullDownloads.delete(pack.sha256);
              throw error;
            }),
          );
        return fullDownloads.get(pack.sha256)!;
      };
      if (full) return { file: await getFull(), start: 0 };
      const started = performance.now();
      const response = await this.fetchImpl(url, {
        headers: { Range: `bytes=${range.offset}-${range.end - 1}` },
      });
      const latency = (performance.now() - started) / 1000;
      if (response.status === 200) {
        await response.body?.cancel();
        return { file: await getFull(), start: 0 };
      }
      if (
        response.status !== 206 ||
        response.headers.get('content-range') !==
          `bytes ${range.offset}-${range.end - 1}/${pack.size}`
      ) {
        await response.body?.cancel();
        throw new Error(`Invalid pack Range response (${response.status})`);
      }
      const file = await save(response, range.end - range.offset);
      const seconds = (performance.now() - started) / 1000 - latency;
      if (seconds > 0)
        this.timing = {
          bytesPerSecond: Math.max(1024, (range.end - range.offset) / seconds),
          latency: Math.max(0.001, latency),
        };
      return { file, start: range.offset };
    };
    const execute = async (range: Range, full: boolean) => {
      let result: Awaited<ReturnType<typeof fetchRange>> | undefined;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await fetchRange(range, full);
            break;
          } catch (error) {
            if (attempt === 1) throw error;
          }
        }
      } catch (error) {
        if (range.frames.every((frame) => frame.fromSha256)) {
          for (const frame of range.frames) failedPatches.add(frame.toSha256);
          return;
        }
        throw error;
      }
      const file = await open(result!.file, 'r');
      try {
        for (const frame of range.frames) {
          try {
            const raw = Buffer.alloc(frame.length);
            let offset = 0;
            while (offset < raw.length) {
              const { bytesRead } = await file.read(
                raw,
                offset,
                raw.length - offset,
                frame.offset - result!.start + offset,
              );
              if (!bytesRead) throw new Error('Truncated frame');
              offset += bytesRead;
            }
            if (sha256File(raw) !== frame.compressedSha256) throw new Error('Frame hash mismatch');
            const dictionary = frame.fromSha256
              ? await readFile(local.get(frame.fromSha256)!)
              : undefined;
            if (dictionary && sha256File(dictionary) !== frame.fromSha256)
              throw new Error('Patch base changed');
            const bytes = Buffer.from(
              await decompress(raw, {
                dictionary,
                maxOutputLength: Math.max(1, sizes.get(frame.toSha256)!),
              }),
            );
            if (bytes.length !== sizes.get(frame.toSha256) || sha256File(bytes) !== frame.toSha256)
              throw new Error('Content mismatch');
            await put(frame.toSha256, bytes);
            downloaded[frame.fromSha256 ? 'patches' : 'objects'] += 1;
          } catch (error) {
            if (!frame.fromSha256) throw error;
            failedPatches.add(frame.toSha256);
          }
        }
      } finally {
        await file.close();
      }
    };
    const run = async (ranges: Range[], full: boolean) => {
      let next = 0;
      let failed = false;
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, async () => {
          while (!failed && next < ranges.length) {
            try {
              await execute(ranges[next++], full);
            } catch (error) {
              failed = true;
              throw error;
            }
          }
        }),
      );
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
    };
    try {
      await run(plan.ranges, plan.full);
      if (failedPatches.size) {
        const retry = planPackDownload(
          { ...manifest, patches: [] },
          [...failedPatches],
          local,
          this.timing,
        );
        await run(retry.ranges, retry.full);
      }
      return { downloaded, fallbackFull: usedFull };
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  }
}
