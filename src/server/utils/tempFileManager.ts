import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Utility class for safely storing temporary files
 */
export class TempFileManager {
  private readonly tempDir: string;
  private filePaths: Set<string> = new Set();

  constructor(dirname: string) {
    // Create unique temporary directory (cross-platform safe)
    this.tempDir = mkdtempSync(join(tmpdir(), dirname));
    // Register cleanup hook for process exit
    this.registerCleanupHook();
  }

  /**
   * Write Uint8Array data to a temporary file

   */
  async writeTempFile(data: Uint8Array, name: string): Promise<string> {
    const filePath = join(this.tempDir, name);

    try {
      writeFileSync(filePath, data);
      this.filePaths.add(filePath);
      return filePath;
    } catch (error) {
      this.cleanup(); // Immediately cleanup on write failure
      throw new Error(`Failed to write temp file: ${(error as Error).message}`);
    }
  }

  /**
   * Safely cleanup temporary resources
   */
  cleanup(): void {
    if (existsSync(this.tempDir)) {
      // Recursively delete directory and its contents
      rmSync(this.tempDir, { force: true, recursive: true });
      this.filePaths.clear();
    }
  }

  /**
   * Register automatic cleanup on process exit/exception
   */
  private registerCleanupHook(): void {
    // Normal exit
    process.on('exit', () => this.cleanup());
    // Exception exit
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception, cleaning temp files:', err);
      this.cleanup();
      process.exit(1);
    });
    // Signal termination
    ['SIGINT', 'SIGTERM'].forEach((signal) => {
      process.on(signal, () => {
        this.cleanup();
        process.exit(0);
      });
    });
  }
}
