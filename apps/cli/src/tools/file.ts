import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createPatch } from 'diff';
import fg from 'fast-glob';

import { log } from '../utils/logger';

// ─── readLocalFile ───

interface ReadFileParams {
  fullContent?: boolean;
  loc?: [number, number];
  path: string;
}

export async function readLocalFile({ path: filePath, loc, fullContent }: ReadFileParams) {
  const effectiveLoc = fullContent ? undefined : (loc ?? [0, 200]);
  log.debug(`Reading file: ${filePath}, loc=${JSON.stringify(effectiveLoc)}`);

  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const totalLineCount = lines.length;
    const totalCharCount = content.length;

    let selectedContent: string;
    let lineCount: number;
    let actualLoc: [number, number];

    if (effectiveLoc === undefined) {
      selectedContent = content;
      lineCount = totalLineCount;
      actualLoc = [0, totalLineCount];
    } else {
      const [startLine, endLine] = effectiveLoc;
      const selectedLines = lines.slice(startLine, endLine);
      selectedContent = selectedLines.join('\n');
      lineCount = selectedLines.length;
      actualLoc = effectiveLoc;
    }

    const fileStat = await stat(filePath);

    return {
      charCount: selectedContent.length,
      content: selectedContent,
      createdTime: fileStat.birthtime,
      fileType: path.extname(filePath).toLowerCase().replace('.', '') || 'unknown',
      filename: path.basename(filePath),
      lineCount,
      loc: actualLoc,
      modifiedTime: fileStat.mtime,
      totalCharCount,
      totalLineCount,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    return {
      charCount: 0,
      content: `Error accessing or processing file: ${errorMessage}`,
      createdTime: new Date(),
      fileType: path.extname(filePath).toLowerCase().replace('.', '') || 'unknown',
      filename: path.basename(filePath),
      lineCount: 0,
      loc: [0, 0] as [number, number],
      modifiedTime: new Date(),
      totalCharCount: 0,
      totalLineCount: 0,
    };
  }
}

// ─── writeLocalFile ───

interface WriteFileParams {
  content: string;
  path: string;
}

export async function writeLocalFile({ path: filePath, content }: WriteFileParams) {
  if (!filePath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  try {
    const dirname = path.dirname(filePath);
    await mkdir(dirname, { recursive: true });
    await writeFile(filePath, content, 'utf8');
    log.debug(`File written: ${filePath} (${content.length} chars)`);
    return { success: true };
  } catch (error) {
    return { error: `Failed to write file: ${(error as Error).message}`, success: false };
  }
}

// ─── editLocalFile ───

interface EditFileParams {
  file_path: string;
  new_string: string;
  old_string: string;
  replace_all?: boolean;
}

export async function editLocalFile({
  file_path: filePath,
  old_string,
  new_string,
  replace_all = false,
}: EditFileParams) {
  try {
    const content = await readFile(filePath, 'utf8');

    if (!content.includes(old_string)) {
      return {
        error: 'The specified old_string was not found in the file',
        replacements: 0,
        success: false,
      };
    }

    let newContent: string;
    let replacements: number;

    if (replace_all) {
      const regex = new RegExp(old_string.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g');
      const matches = content.match(regex);
      replacements = matches ? matches.length : 0;
      newContent = content.replaceAll(old_string, new_string);
    } else {
      const index = content.indexOf(old_string);
      if (index === -1) {
        return { error: 'Old string not found', replacements: 0, success: false };
      }
      newContent = content.slice(0, index) + new_string + content.slice(index + old_string.length);
      replacements = 1;
    }

    await writeFile(filePath, newContent, 'utf8');

    const patch = createPatch(filePath, content, newContent, '', '');
    const diffText = `diff --git a${filePath} b${filePath}\n${patch}`;

    const patchLines = patch.split('\n');
    let linesAdded = 0;
    let linesDeleted = 0;

    for (const line of patchLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
      else if (line.startsWith('-') && !line.startsWith('---')) linesDeleted++;
    }

    return { diffText, linesAdded, linesDeleted, replacements, success: true };
  } catch (error) {
    return { error: (error as Error).message, replacements: 0, success: false };
  }
}

// ─── listLocalFiles ───

interface ListFilesParams {
  limit?: number;
  path: string;
  sortBy?: 'createdTime' | 'modifiedTime' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export async function listLocalFiles({
  path: dirPath,
  sortBy = 'modifiedTime',
  sortOrder = 'desc',
  limit = 100,
}: ListFilesParams) {
  try {
    const entries = await readdir(dirPath);
    const results: any[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stats = await stat(fullPath);
        const isDirectory = stats.isDirectory();
        results.push({
          createdTime: stats.birthtime,
          isDirectory,
          lastAccessTime: stats.atime,
          modifiedTime: stats.mtime,
          name: entry,
          path: fullPath,
          size: stats.size,
          type: isDirectory ? 'directory' : path.extname(entry).toLowerCase().replace('.', ''),
        });
      } catch {
        // Skip files we can't stat
      }
    }

    results.sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'name': {
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        }
        case 'modifiedTime': {
          comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
          break;
        }
        case 'createdTime': {
          comparison = a.createdTime.getTime() - b.createdTime.getTime();
          break;
        }
        case 'size': {
          comparison = a.size - b.size;
          break;
        }
        default: {
          comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
        }
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const totalCount = results.length;
    return { files: results.slice(0, limit), totalCount };
  } catch (error) {
    log.error(`Failed to list directory ${dirPath}:`, error);
    return { files: [], totalCount: 0 };
  }
}

// ─── globLocalFiles ───

interface GlobFilesParams {
  cwd?: string;
  pattern: string;
}

export async function globLocalFiles({ pattern, cwd }: GlobFilesParams) {
  try {
    const files = await fg(pattern, {
      cwd: cwd || process.cwd(),
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
    return { files };
  } catch (error) {
    return { error: (error as Error).message, files: [] };
  }
}

// ─── grepContent ───

interface GrepContentParams {
  cwd?: string;
  filePattern?: string;
  pattern: string;
}

export async function grepContent({ pattern, cwd, filePattern }: GrepContentParams) {
  const { spawn } = await import('node:child_process');

  return new Promise<{ matches: any[]; success: boolean }>((resolve) => {
    const args = ['--json', '-n'];
    if (filePattern) args.push('--glob', filePattern);
    args.push(pattern);

    const child = spawn('rg', args, { cwd: cwd || process.cwd() });
    let stdout = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', () => {
      // stderr consumed but not used
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        // Fallback: use simple regex search
        log.debug('rg not available, falling back to simple search');
        resolve({ matches: [], success: false });
        return;
      }

      try {
        const matches = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        resolve({ matches, success: true });
      } catch {
        resolve({ matches: [], success: true });
      }
    });

    child.on('error', () => {
      log.debug('rg not available');
      resolve({ matches: [], success: false });
    });
  });
}

// ─── searchLocalFiles ───

interface SearchFilesParams {
  contentContains?: string;
  directory?: string;
  keywords: string;
  limit?: number;
}

export async function searchLocalFiles({
  keywords,
  directory,
  contentContains,
  limit = 30,
}: SearchFilesParams) {
  try {
    const cwd = directory || process.cwd();
    const files = await fg(`**/*${keywords}*`, {
      cwd,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    let results = files.map((f) => ({ name: path.basename(f), path: path.join(cwd, f) }));

    if (contentContains) {
      const filtered: typeof results = [];
      for (const file of results) {
        try {
          const content = await readFile(file.path, 'utf8');
          if (content.includes(contentContains)) {
            filtered.push(file);
          }
        } catch {
          // Skip unreadable files
        }
      }
      results = filtered;
    }

    return results.slice(0, limit);
  } catch (error) {
    log.error('File search failed:', error);
    return [];
  }
}
