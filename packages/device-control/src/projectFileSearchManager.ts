import { spawn } from 'node:child_process';
import path from 'node:path';

import fg from 'fast-glob';

import type { ProjectFileIndexEntry } from './types';

const PROJECT_FILE_SEARCH_SCAN_LIMIT = 5000;
const PROJECT_FILE_SEARCH_COMMAND_TIMEOUT_MS = 10_000;

interface FileFinderCommand {
  args: string[];
  command: string;
}

class ProjectFileSearchManager {
  private createFileFinderCommands(scope: string): FileFinderCommand[] {
    return [
      {
        args: [
          '--type',
          'f',
          '--color',
          'never',
          '--hidden',
          '--exclude',
          '.git',
          '--exclude',
          'node_modules',
        ],
        command: 'fd',
      },
      {
        args: [
          '--type',
          'f',
          '--color',
          'never',
          '--hidden',
          '--exclude',
          '.git',
          '--exclude',
          'node_modules',
        ],
        command: 'fdfind',
      },
      {
        args: [
          '--files',
          '--color',
          'never',
          '--hidden',
          '--glob',
          '!.git/**',
          '--glob',
          '!node_modules/**',
        ],
        command: 'rg',
      },
      {
        args: ['.', '-type', 'f', '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*'],
        command: 'find',
      },
      {
        args: ['/r', scope, '*'],
        command: 'where',
      },
    ];
  }

  async collectNonGitFilePaths(scope: string): Promise<string[]> {
    for (const finder of this.createFileFinderCommands(scope)) {
      const files = await this.tryCollectCommandFilePaths(scope, finder);
      if (files.length > 0) return files;
    }

    return this.collectFastGlobFilePaths(scope);
  }

  selectEntries(
    entries: ProjectFileIndexEntry[],
    query: string,
    limit: number,
  ): ProjectFileIndexEntry[] {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return [];

    const entryByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
    const scoredEntries = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({ entry, score: this.scoreProjectFileEntry(entry, normalizedQuery) }))
      .filter(
        (result): result is { entry: ProjectFileIndexEntry; score: number } =>
          result.score !== null,
      )
      .sort((a, b) => a.score - b.score || a.entry.relativePath.localeCompare(b.entry.relativePath))
      .slice(0, limit);

    const visiblePaths = new Set<string>();
    for (const { entry } of scoredEntries) {
      visiblePaths.add(entry.relativePath);
      let current = path.dirname(entry.relativePath);
      while (current && current !== '.') {
        const directoryPath = `${this.toPosixRelativePath(current)}/`;
        if (entryByPath.has(directoryPath)) visiblePaths.add(directoryPath);
        current = path.dirname(current);
      }
    }

    return entries.filter((entry) => visiblePaths.has(entry.relativePath));
  }

  private async collectCommandFilePaths(
    scope: string,
    finder: FileFinderCommand,
    limit: number,
  ): Promise<string[]> {
    const child = spawn(finder.command, finder.args, {
      cwd: scope,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files: string[] = [];
    const seen = new Set<string>();
    let pending = '';
    let settled = false;

    const cleanup = (timer: NodeJS.Timeout) => {
      settled = true;
      clearTimeout(timer);
      child.stdout.removeAllListeners();
      child.removeAllListeners();
    };

    return new Promise((resolve, reject) => {
      const addLine = (line: string) => {
        const filePath = this.normalizeFinderOutputPath(scope, line);
        if (!filePath || seen.has(filePath)) return;
        seen.add(filePath);
        files.push(filePath);
        if (files.length >= limit && !child.killed) child.kill();
      };

      const flushChunk = (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) addLine(line);
      };

      const timer = setTimeout(() => {
        if (!child.killed) child.kill();
      }, PROJECT_FILE_SEARCH_COMMAND_TIMEOUT_MS);

      child.stdout.on('data', flushChunk);
      child.on('error', (error) => {
        if (settled) return;
        cleanup(timer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        if (pending) addLine(pending);
        cleanup(timer);

        if (files.length > 0 || code === 0) {
          resolve(files);
          return;
        }

        reject(new Error(`${finder.command} exited with code ${code ?? signal ?? 'unknown'}`));
      });
    });
  }

  private async collectFastGlobFilePaths(scope: string): Promise<string[]> {
    const files: string[] = [];
    const stream = fg.stream('**/*', {
      cwd: scope,
      dot: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
      onlyFiles: true,
    });

    for await (const relativePath of stream as AsyncIterable<string>) {
      files.push(path.resolve(scope, relativePath));
      if (files.length >= PROJECT_FILE_SEARCH_SCAN_LIMIT) break;
    }

    return files;
  }

  private fuzzySequenceScore(candidate: string, query: string): number | null {
    let queryIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;

    for (let i = 0; i < candidate.length && queryIndex < query.length; i++) {
      if (candidate[i] !== query[queryIndex]) continue;
      if (firstMatch < 0) firstMatch = i;
      lastMatch = i;
      queryIndex++;
    }

    if (queryIndex !== query.length) return null;
    return 50 + firstMatch + Math.max(0, lastMatch - firstMatch - query.length);
  }

  private normalizeFinderOutputPath(scope: string, outputPath: string): string | undefined {
    const trimmed = outputPath.trim();
    if (!trimmed) return;

    const withoutLeadingDot = trimmed.startsWith(`.${path.sep}`)
      ? trimmed.slice(2)
      : trimmed.startsWith('./')
        ? trimmed.slice(2)
        : trimmed;

    return path.resolve(scope, withoutLeadingDot);
  }

  private normalizeSearchText(value: string) {
    return value.trim().toLocaleLowerCase();
  }

  private scoreProjectFileEntry(entry: ProjectFileIndexEntry, query: string): number | null {
    const name = this.normalizeSearchText(entry.name);
    const relativePath = this.normalizeSearchText(entry.relativePath);

    if (name === query) return 0;
    if (relativePath === query) return 1;
    if (name.startsWith(query)) return 5 + name.length - query.length;
    if (relativePath.startsWith(query)) return 10 + relativePath.length - query.length;
    if (name.includes(query)) return 20 + name.indexOf(query);
    if (relativePath.includes(query)) return 30 + relativePath.indexOf(query);

    return this.fuzzySequenceScore(relativePath, query);
  }

  private toPosixRelativePath(filePath: string) {
    return filePath.split(path.sep).join('/');
  }

  private async tryCollectCommandFilePaths(
    scope: string,
    finder: FileFinderCommand,
  ): Promise<string[]> {
    try {
      return await this.collectCommandFilePaths(scope, finder, PROJECT_FILE_SEARCH_SCAN_LIMIT);
    } catch {
      return [];
    }
  }
}

export const projectFileSearchManager = new ProjectFileSearchManager();
