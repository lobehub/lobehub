import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

import type { GoalTrajectory } from '../types';

const decompressZstd = promisify(zstdDecompress);

const DEFAULT_DIR = '.goal-tracing';
const REMOTE_DIR = '_remote';

// Zstd frame magic — first 4 bytes of any zstd stream.
// https://datatracker.ietf.org/doc/html/rfc8478#section-3.1.1
const isZstdFrame = (buffer: Buffer): boolean =>
  buffer.length >= 4 &&
  buffer[0] === 0x28 &&
  buffer[1] === 0xb5 &&
  buffer[2] === 0x2f &&
  buffer[3] === 0xfd;

/**
 * Downloaded goal trajectories, cached as plain JSON for easy inspection.
 *
 * Unlike the operation store there is no URL to build from the id: a goal
 * trajectory is only reachable through a signed URL the server hands out, so
 * this never guesses a bucket layout.
 */
export class RemoteGoalTraceStore {
  private cacheDir: string;

  constructor(rootDir?: string) {
    this.cacheDir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR, REMOTE_DIR);
  }

  private cachePath(goalId: string): string {
    return path.join(this.cacheDir, `${goalId.replaceAll(/[^\w-]/g, '_')}.json`);
  }

  async getCached(goalId: string): Promise<GoalTrajectory | null> {
    try {
      return JSON.parse(await fs.readFile(this.cachePath(goalId), 'utf8')) as GoalTrajectory;
    } catch {
      return null;
    }
  }

  async fetch(url: string, goalId: string): Promise<GoalTrajectory> {
    console.error(`↓ Downloading trajectory: ${goalId}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch goal trajectory: ${response.status} ${response.statusText}`);
    }

    // Decode by content rather than by URL suffix, so a signed URL whose query
    // string hides the extension still decompresses correctly.
    const body = Buffer.from(await response.arrayBuffer());
    const decoded = isZstdFrame(body) ? await decompressZstd(body) : body;
    const trajectory = JSON.parse(decoded.toString('utf8')) as GoalTrajectory;

    // Only a finished goal is safe to cache. A running one is a snapshot of a
    // moving object, and caching it would pin the reader to whatever the goal
    // happened to look like the first time it was inspected.
    if (trajectory.completionReason) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(this.cachePath(goalId), JSON.stringify(trajectory, null, 2), 'utf8');
      console.error(`✓ Cached to: ${DEFAULT_DIR}/${REMOTE_DIR}/${goalId}.json`);
    }

    return trajectory;
  }
}
