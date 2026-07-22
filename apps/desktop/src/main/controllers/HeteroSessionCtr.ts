import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  buildClaudeCodeImportPayload,
  buildCodexImportPayload,
  parseClaudeCodeSession,
  parseClaudeCodeSessionDigest,
  parseCodexSessionDigest,
} from '@lobechat/heterogeneous-agents/transcript';
import type {
  HeteroSessionDigest,
  HeteroSessionDirGroup,
  HeteroSessionDirPref,
  HeteroSessionImportPayload,
  HeteroSessionImportSource,
  HeteroSessionScanResult,
} from '@lobechat/types';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:HeteroSessionCtr');

const claudeProjectsRoot = () => path.join(homedir(), '.claude', 'projects');
const codexSessionsRoot = () => path.join(homedir(), '.codex', 'sessions');

/**
 * Is `filePath` contained in `root`? The separator must come from the platform
 * (`path.sep`), not a literal "/": on Windows the resolved path is separated by
 * "\", so a hard-coded "/" boundary rejects every real transcript.
 *
 * `p` is injectable so the win32 behaviour is testable from any platform.
 */
export const isUnderRoot = (filePath: string, root: string, p: path.PlatformPath = path) =>
  p.resolve(filePath).startsWith(p.resolve(root) + p.sep);

/**
 * Sessions recorded under throwaway directories (agent probes, mkdtemp
 * scratch dirs) are ignored by default — they land in the Ignored group and
 * can be restored explicitly (which stores a `none` pref so the default
 * doesn't re-apply).
 */
const TEMP_DIR_PREFIXES = ['/tmp/', '/private/tmp/', '/private/var/folders/', '/var/folders/'];
const isTempWorkingDirectory = (dir: string) =>
  TEMP_DIR_PREFIXES.some((prefix) => dir.startsWith(prefix)) ||
  dir === '/tmp' ||
  dir === '/private/tmp';

/**
 * HeteroSessionController
 *
 * Discovers local CLI agent transcripts (Claude Code / Codex) and turns them
 * into normalized import payloads for `topic.importHeteroSessions`.
 *
 * Grouping is keyed by the RESOLVED workingDirectory, not the storage folder:
 * a session started in the main repo and switched into a worktree is stored
 * under the worktree slug folder while its cwd still points at the main repo,
 * so several storage folders can map onto one cwd.
 */
export default class HeteroSessionController extends ControllerModule {
  static override readonly groupName = 'heteroSession';

  /**
   * Full scan of both CLI transcript roots. Per-file failures land in
   * `errors` instead of failing the scan.
   */
  @IpcMethod()
  async listLocalSessions(): Promise<HeteroSessionScanResult> {
    const errors: string[] = [];
    const groups = new Map<string, HeteroSessionDirGroup>();

    const addDigest = (source: HeteroSessionImportSource, digest: HeteroSessionDigest) => {
      if (!digest.workingDirectory) return;
      const key = `${source}::${digest.workingDirectory}`;
      const group = groups.get(key) ?? {
        isGit: false,
        sessionCount: 0,
        sessions: [],
        source,
        totalTokens: 0,
        workingDirectory: digest.workingDirectory,
      };
      group.sessionCount++;
      group.totalTokens += digest.tokens ?? 0;
      group.isGit ||= Boolean(digest.gitBranch);
      group.sessions.push(digest);
      groups.set(key, group);
    };

    // Claude Code: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
    const ccRoot = claudeProjectsRoot();
    if (existsSync(ccRoot)) {
      for (const folder of await readdir(ccRoot)) {
        const folderPath = path.join(ccRoot, folder);
        try {
          if (!(await stat(folderPath)).isDirectory()) continue;
        } catch {
          continue;
        }
        for (const file of await readdir(folderPath)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(folderPath, file);
          try {
            if (!(await stat(filePath)).isFile()) continue;
            const digest = parseClaudeCodeSessionDigest(await readFile(filePath, 'utf8'), filePath);
            if (digest) addDigest('claude-code', digest);
          } catch (error) {
            errors.push(`${filePath}: ${(error as Error).message}`);
          }
        }
      }
    }

    // Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    const codexRoot = codexSessionsRoot();
    if (existsSync(codexRoot)) {
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir)) {
          const entryPath = path.join(dir, entry);
          try {
            const info = await stat(entryPath);
            if (info.isDirectory()) {
              await walk(entryPath);
            } else if (entry.endsWith('.jsonl')) {
              const digest = parseCodexSessionDigest(await readFile(entryPath, 'utf8'), entryPath);
              if (digest) addDigest('codex', digest);
            }
          } catch (error) {
            errors.push(`${entryPath}: ${(error as Error).message}`);
          }
        }
      };
      await walk(codexRoot);
    }

    const dirPrefs = this.app.storeManager.get('heteroSessionDirPrefs', {});
    const result = [...groups.values()]
      .map((group) => {
        group.sessions.sort((a, b) => (b.endAt ?? '').localeCompare(a.endAt ?? ''));
        const stored = dirPrefs[`${group.source}::${group.workingDirectory}`];
        // stored 'none' = user explicitly restored a default-ignored dir
        const pref =
          stored === 'none'
            ? undefined
            : (stored ?? (isTempWorkingDirectory(group.workingDirectory) ? 'ignored' : undefined));
        return pref ? { ...group, dirPref: pref } : group;
      })
      .sort((a, b) => b.sessionCount - a.sessionCount);

    logger.debug(
      `scanned ${result.reduce((s, g) => s + g.sessionCount, 0)} sessions in ${result.length} dirs (${errors.length} errors)`,
    );
    return { errors, groups: result };
  }

  /**
   * Parse one transcript into the normalized import payload. For Claude Code,
   * subagent transcripts under `<sessionId>/subagents/` are attached as threads.
   */
  @IpcMethod()
  async readLocalSession(params: {
    filePath: string;
    source: HeteroSessionImportSource;
  }): Promise<HeteroSessionImportPayload | null> {
    const { filePath, source } = params;
    const root = source === 'claude-code' ? claudeProjectsRoot() : codexSessionsRoot();
    // IPC-exposed file read — only transcripts under the CLI roots are readable
    if (!isUnderRoot(filePath, root)) {
      throw new Error(`refusing to read transcript outside ${root}`);
    }

    const content = await readFile(filePath, 'utf8');
    if (source === 'codex') return buildCodexImportPayload(content);

    const payload = buildClaudeCodeImportPayload(content);
    if (!payload) return null;

    const subagentsDir = path.join(
      path.dirname(filePath),
      path.basename(filePath, '.jsonl'),
      'subagents',
    );
    if (existsSync(subagentsDir)) {
      const threads: NonNullable<HeteroSessionImportPayload['threads']> = [];
      for (const file of await readdir(subagentsDir)) {
        if (!file.endsWith('.jsonl')) continue;
        try {
          const parsed = parseClaudeCodeSession(
            await readFile(path.join(subagentsDir, file), 'utf8'),
            {
              sessionIdOverride: payload.sessionId,
              sidechain: true,
            },
          );
          if (!parsed) continue;
          threads.push({
            // agent file names (`agent-<hex>`) are globally unique — no session scoping needed
            clientId: `claude-code-thread-${path.basename(file, '.jsonl')}`,
            messages: parsed.messages,
            title: parsed.title,
            type: 'standalone',
          });
        } catch (error) {
          logger.warn(`failed to parse subagent transcript ${file}: ${(error as Error).message}`);
        }
      }
      if (threads.length > 0) payload.threads = threads;
    }

    return payload;
  }

  @IpcMethod()
  async getDirPrefs(): Promise<Record<string, HeteroSessionDirPref>> {
    return this.app.storeManager.get('heteroSessionDirPrefs', {});
  }

  /**
   * Set or clear (pref = null) the preference of one directory,
   * keyed by `${source}::${workingDirectory}`. Clearing a default-ignored
   * (temp) directory stores `none` so the default doesn't re-apply.
   */
  @IpcMethod()
  async setDirPref(params: { key: string; pref: HeteroSessionDirPref | null }): Promise<void> {
    const prefs = { ...this.app.storeManager.get('heteroSessionDirPrefs', {}) };
    const workingDirectory = params.key.split('::')[1] ?? '';
    if (params.pref) prefs[params.key] = params.pref;
    else if (isTempWorkingDirectory(workingDirectory)) prefs[params.key] = 'none';
    else delete prefs[params.key];
    this.app.storeManager.set('heteroSessionDirPrefs', prefs);
  }
}
