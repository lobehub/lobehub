import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface BuildOptions {
  configFile: string;
  hostDir: string;
  logFile?: string;
  outDir: string;
  root: string;
}

const WORKER = path.join(import.meta.dirname, 'worker.ts');

export const buildSide = async ({ configFile, hostDir, logFile, outDir, root }: BuildOptions) => {
  const started = performance.now();
  const log = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.env.STYLE_EQ_BUN ?? 'bun',
      [WORKER, configFile, root, hostDir, outDir],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `BUILD_FAILED\n${output.length > 8000 ? `${output.slice(0, 4000)}\n…\n${output.slice(-4000)}` : output}`,
            ),
          ),
    );
  });
  if (logFile) await writeFile(logFile, log);
  return { dist: outDir, durationMs: Math.round(performance.now() - started) };
};
