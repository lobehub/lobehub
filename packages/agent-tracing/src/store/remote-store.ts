import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

import type { ExecutionSnapshot } from '../types';

const decompressZstd = promisify(zstdDecompress);

const REMOTE_DIR = '_remote';
const ENV_FILE = '.env';
const DEFAULT_DIR = '.agent-tracing';

// zstd frame magic: 0x28 0xb5 0x2f 0xfd. Used to auto-detect the body format
// regardless of which environment uploaded it (prod writes `.json.zst`, local
// dev writes plain `.json`).
const isZstdFrame = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x28 &&
  bytes[1] === 0xb5 &&
  bytes[2] === 0x2f &&
  bytes[3] === 0xfd;

/**
 * Parse an operation ID to extract agentId and topicId for URL construction.
 *
 * Format: op_{timestamp}_agt_{agentHash}_tpc_{topicHash}_{suffix}
 * Example: op_1775743208456_agt_6OfrfD6sRP2x_tpc_lMs3V4bpXa5x_9fRnPApi
 */
export function parseOperationId(opId: string): {
  agentId: string;
  operationId: string;
  topicId: string;
} | null {
  const agtMatch = opId.match(/(agt_[A-Za-z0-9]+)/);
  const tpcMatch = opId.match(/(tpc_[A-Za-z0-9]+)/);
  if (!agtMatch || !tpcMatch) return null;
  return { agentId: agtMatch[1], operationId: opId, topicId: tpcMatch[1] };
}

export function isOperationId(input: string): boolean {
  return input.startsWith('op_') && input.includes('_agt_') && input.includes('_tpc_');
}

export function buildRemoteUrl(baseUrl: string, opId: string): string | null {
  const parsed = parseOperationId(opId);
  if (!parsed) return null;
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${parsed.agentId}/${parsed.topicId}/${parsed.operationId}.json.zst`;
}

/**
 * Load TRACING_BASE_URL from environment variable or .agent-tracing/.env file.
 */
export async function loadBaseUrl(rootDir?: string): Promise<string | null> {
  // 1. Check environment variable
  if (process.env.TRACING_BASE_URL) return process.env.TRACING_BASE_URL;

  // 2. Check .agent-tracing/.env
  const dir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR);
  const envPath = path.join(dir, ENV_FILE);
  try {
    const content = await fs.readFile(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;
      if (!trimmed.startsWith('TRACING_BASE_URL')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replaceAll(/^["']|["']$/g, '');
      if (value) return value;
    }
  } catch {
    // no .env file
  }
  return null;
}

export class RemoteSnapshotStore {
  private cacheDir: string;

  constructor(rootDir?: string) {
    this.cacheDir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR, REMOTE_DIR);
  }

  async getCached(operationId: string): Promise<ExecutionSnapshot | null> {
    try {
      const filePath = path.join(this.cacheDir, `${operationId}.json`);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    } catch {
      return null;
    }
  }

  async fetch(url: string, operationId: string): Promise<ExecutionSnapshot> {
    // Check cache first
    const cached = await this.getCached(operationId);
    if (cached) {
      console.error(`✓ Loaded from cache: _remote/${operationId}.json`);
      return cached;
    }

    // Download. Prod uploads `.json.zst`, local dev uploads plain `.json`. Try
    // the zstd suffix first (dominant case); on 404 fall back to the plain
    // sibling so dev-uploaded snapshots remain inspectable from another machine.
    console.error(`↓ Downloading: ${url}`);
    let res = await fetch(url);
    if (res.status === 404 && url.endsWith('.json.zst')) {
      const plainUrl = url.slice(0, -'.zst'.length);
      console.error(`↓ Falling back to plain JSON: ${plainUrl}`);
      res = await fetch(plainUrl);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch snapshot: ${res.status} ${res.statusText}\n  URL: ${url}`);
    }

    // Body format is determined by sniffing magic bytes, not by URL suffix —
    // covers any combination of upload/download environment.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const json = isZstdFrame(bytes)
      ? (await decompressZstd(Buffer.from(bytes))).toString('utf8')
      : Buffer.from(bytes).toString('utf8');
    const snapshot = JSON.parse(json) as ExecutionSnapshot;

    // Cache locally as plain JSON for easy inspection.
    await fs.mkdir(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `${operationId}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    console.error(`✓ Cached to: _remote/${operationId}.json`);

    return snapshot;
  }
}
