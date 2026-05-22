import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { TracingPayload, TracingSummary } from '../types';
import type { ITracingStore, SaveResult } from './types';

export const DEFAULT_DIR = '.llm-generation-tracing';

const safeSegment = (value: string): string => value.replaceAll(/[^\w.-]+/g, '_') || 'unknown';

/**
 * Local / dev / desktop store. Writes plain JSON (no compression) so contents
 * can be inspected with `cat`. Layout mirrors the S3 key pattern:
 *
 *   .llm-generation-tracing/{scenario}/{promptVersion}-{promptHash}/{file}.json
 *
 * Keeps a top-level `latest.json` symlink pointing at the most recent record.
 */
export class FileTracingStore implements ITracingStore {
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR);
  }

  async save(record: TracingPayload): Promise<SaveResult> {
    const dir = this.bucketDir(record);
    await fs.mkdir(dir, { recursive: true });

    const ts = new Date(record.created_at).toISOString().replaceAll(':', '-');
    const shortId = safeSegment(record.tracing_id.slice(0, 12));
    const filename = `${ts}_${shortId}.json`;
    const filePath = path.join(dir, filename);

    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    await this.updateLatestSymlink(filePath);

    return { key: path.relative(this.root, filePath) };
  }

  async get(key: string): Promise<TracingPayload | null> {
    const target = path.isAbsolute(key) ? key : path.join(this.root, key);
    try {
      const content = await fs.readFile(target, 'utf8');
      return JSON.parse(content) as TracingPayload;
    } catch {
      return null;
    }
  }

  async list(options?: { limit?: number }): Promise<TracingSummary[]> {
    const limit = options?.limit ?? 20;
    const files = await this.collectFiles();
    files.sort((a, b) => (a.filename < b.filename ? 1 : -1));

    const summaries: TracingSummary[] = [];
    for (const file of files.slice(0, limit)) {
      try {
        const content = await fs.readFile(file.fullPath, 'utf8');
        const record = JSON.parse(content) as TracingPayload;
        summaries.push({
          created_at: record.created_at,
          model: record.model_metadata?.model,
          prompt_version: record.prompt_version,
          scenario: record.scenario,
          success: !record.error,
          tracing_id: record.tracing_id,
          validation_failed: record.validation_failed,
        });
      } catch {
        // skip corrupted files
      }
    }
    return summaries;
  }

  private bucketDir(record: TracingPayload): string {
    return path.join(
      this.root,
      safeSegment(record.scenario),
      `${safeSegment(record.prompt_version)}-${safeSegment(record.prompt_hash)}`,
    );
  }

  private async updateLatestSymlink(filePath: string): Promise<void> {
    const latestPath = path.join(this.root, 'latest.json');
    try {
      await fs.unlink(latestPath);
    } catch {
      // ignore — no previous symlink
    }
    try {
      await fs.symlink(path.relative(this.root, filePath), latestPath);
    } catch {
      // file systems without symlink support (e.g. Windows w/o dev mode) — silently skip
    }
  }

  private async collectFiles(): Promise<{ filename: string; fullPath: string }[]> {
    const results: { filename: string; fullPath: string }[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name.endsWith('.json') && entry.name !== 'latest.json') {
          results.push({ filename: entry.name, fullPath: full });
        }
      }
    };

    await walk(this.root);
    return results;
  }
}
