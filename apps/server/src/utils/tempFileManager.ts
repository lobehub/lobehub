import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Utility class for safely storing temporary files. Callers clean up in `finally`.
 *
 * It installs no process hooks: an exiting SIGTERM listener would cut short the
 * runtime's graceful shutdown, and an exiting `uncaughtException` listener turns
 * any later stray error into a crash. Callers own cleanup; the host owns termination.
 */
export class TempFileManager {
  private tempDir?: Promise<string>;
  private readonly writes = new Set<Promise<string>>();
  private cleanupPromise?: Promise<void>;

  constructor(private readonly dirname: string) {}

  /** Creates the directory asynchronously on first write; no new write is accepted once cleanup has started. */
  async writeTempFile(data: Uint8Array, name: string): Promise<string> {
    if (this.cleanupPromise) throw new Error('Temp file manager is already closed');

    const directory = (this.tempDir ??= mkdtemp(path.join(tmpdir(), this.dirname)));
    const writing = (async () => {
      // Sanitize filename to prevent path traversal (GHSA-2g9j-v25c-4j97)
      const filePath = path.resolve(await directory, path.basename(name));
      await writeFile(filePath, data);
      return filePath;
    })();
    this.writes.add(writing);

    try {
      return await writing;
    } catch (error) {
      // Remove itself first so the cleanup on the failure path does not wait for this write.
      this.writes.delete(writing);
      // A cleanup error must not mask the original write failure.
      await this.cleanup().catch(() => {});
      throw new Error(`Failed to write temp file: ${(error as Error).message}`, { cause: error });
    } finally {
      this.writes.delete(writing);
    }
  }

  /** Callers `await` it in `finally`; concurrent and repeated calls share one cleanup. */
  cleanup(): Promise<void> {
    this.cleanupPromise ??= (async () => {
      // Wait for admitted writes to settle before deleting, so a delete never interleaves with a
      // write and leaves a file behind.
      await Promise.allSettled(this.writes);
      const directory = await this.tempDir?.catch(() => undefined);
      if (directory) await rm(directory, { force: true, recursive: true });
    })();
    return this.cleanupPromise;
  }
}
