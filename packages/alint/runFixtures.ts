import { spawn } from 'node:child_process';
import path from 'node:path';

export interface FixtureDiagnostic {
  file: string;
  line: number;
  message: string;
  rule: string;
}

interface AlintOutput {
  diagnostics: {
    filePath: string;
    loc?: { start?: { line?: number } };
    message: string;
    ruleId: string;
  }[];
}

/** Run the repo's alint once over the fixture files and return root-relative diagnostics. */
export const runFixtureLint = (rootDir: string, files: string[]): Promise<FixtureDiagnostic[]> =>
  new Promise((resolve, reject) => {
    const bin = path.join(rootDir, 'node_modules/.bin/alint');
    const child = spawn(bin, ['--format', 'json', ...files], {
      cwd: rootDir,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 2 || !stdout.trim()) {
        reject(new Error(`alint exited ${code}: ${stderr.trim()}`));
        return;
      }
      const output = JSON.parse(stdout) as AlintOutput;
      resolve(
        output.diagnostics.map((diagnostic) => ({
          file: path.relative(rootDir, diagnostic.filePath),
          line: diagnostic.loc?.start?.line ?? 0,
          message: diagnostic.message.split('\n')[0],
          rule: diagnostic.ruleId,
        })),
      );
    });
  });
