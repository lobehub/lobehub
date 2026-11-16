import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Utility class for safely storing temporary files. Callers clean up in `finally`.
 *
 * It installs no process hooks: an exiting SIGTERM listener would cut short the
 * tenant lease's drain (the pod dies at once and Hatchet re-runs the tasks it
 * held), and an exiting `uncaughtException` listener turns any later stray
 * error into a crash. Files a killed process leaves behind go with the container.
 */
export class TempFileManager {
  private tempDir?: Promise<string>;
  private readonly writes = new Set<Promise<string>>();
  private cleanupPromise?: Promise<void>;

  constructor(private readonly dirname: string) {}

  /** 写入前异步创建目录；回收开始后不再接纳新写入。 */
  async writeTempFile(data: Uint8Array, name: string): Promise<string> {
    if (this.cleanupPromise) throw new Error('Temp file manager is already closed');

    const directory = (this.tempDir ??= mkdtemp(path.join(tmpdir(), this.dirname)));
    const writing = (async () => {
      // 保留 basename 防止调用方传入的文件名穿越临时目录。
      const filePath = path.resolve(await directory, path.basename(name));
      await writeFile(filePath, data);
      return filePath;
    })();
    this.writes.add(writing);

    try {
      return await writing;
    } catch (error) {
      // 先移除自身，避免失败路径的回收等待自己。
      this.writes.delete(writing);
      // 回收错误不能掩盖原始写入失败。
      await this.cleanup().catch(() => {});
      throw new Error(`Failed to write temp file: ${(error as Error).message}`, { cause: error });
    } finally {
      this.writes.delete(writing);
    }
  }

  /** 调用方在 finally 中 await；并发和重复调用共享同一次回收。 */
  cleanup(): Promise<void> {
    this.cleanupPromise ??= (async () => {
      // 等待已接纳的写入结束再删目录，避免删除与写入交错留下文件。
      await Promise.allSettled(this.writes);
      const directory = await this.tempDir?.catch(() => undefined);
      if (directory) await rm(directory, { force: true, recursive: true });
    })();
    return this.cleanupPromise;
  }
}
