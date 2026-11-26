import type {
  GitHubSkillCandidate,
  GitHubSkillDiscovery,
  GitHubSkillOutcome,
} from '@lobechat/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

import { parseGithubSource } from './githubSource';

export interface GithubSkillImportFailure {
  /** The server's own message, for anything without a recovery. */
  details?: string;
  /**
   * `access`: the repository is private or missing for the GitHub access we
   * have, so it needs GitHub connected or a token in the Vault.
   * `connect`: GitHub is not connected at all.
   */
  recovery?: 'access' | 'connect';
  stage: 'find' | 'import' | 'refresh';
}

/** Skills a scan can install: new ones, and newer versions of installed ones. */
export const canImportCandidate = ({ status }: Pick<GitHubSkillCandidate, 'status'>) =>
  status === 'new' || status === 'update';

const importFailure = (error: unknown, stage: 'find' | 'import'): GithubSkillImportFailure => {
  const { code } = normalizeAsyncError(error);
  if (code === 'PRECONDITION_FAILED') return { recovery: 'connect', stage };
  if (code === 'NOT_FOUND') return { recovery: 'access', stage };
  return { details: error instanceof Error ? error.message : String(error), stage };
};

/**
 * The scan → pick → install state of one GitHub repository page. The scan
 * pins a commit, so what is installed is what was listed; one request runs at
 * a time, and a failure stays apart from the per-skill outcomes of a batch.
 */
export const useGithubSkillImport = (initialUrl: string) => {
  const refresh = useToolStore((s) => s.refreshAgentSkills);
  const [pending, setPending] = useState<GithubSkillImportFailure['stage']>();
  const [failure, setFailure] = useState<GithubSkillImportFailure>();
  const [input, setInputValue] = useState(initialUrl);
  const [scan, setScan] = useState<GitHubSkillDiscovery & { url: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<GitHubSkillOutcome[]>([]);
  const busy = useRef(false);

  const source = parseGithubSource(input);
  const candidates = scan?.candidates ?? [];

  /** A scan belongs to the address it was read from, so editing the address drops it. */
  const setInput = (value: string) => {
    setInputValue(value);
    setScan(undefined);
    setResults([]);
    setFailure(undefined);
  };

  const discover = useCallback(async () => {
    const url = parseGithubSource(input)?.url;
    if (!url || busy.current) return;
    busy.current = true;
    setPending('find');
    setFailure(undefined);
    try {
      const next = await agentSkillService.discoverGitHubSkills(url);
      const found = next.candidates ?? [];
      setScan({ ...next, candidates: found, url });
      setResults([]);
      // Everything installable starts picked: adding a repository usually means all of it.
      setSelected(found.filter(canImportCandidate).map((item) => item.path));
    } catch (error) {
      setScan(undefined);
      setFailure(importFailure(error, 'find'));
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  }, [input]);

  // A repository opened from search or from an installed skill scans right away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !parseGithubSource(initialUrl)) return;
    started.current = true;
    void discover();
  }, [discover, initialUrl]);

  const refreshLibrary = async () => {
    setPending('refresh');
    setFailure(undefined);
    try {
      await refresh();
    } catch (error) {
      setFailure({
        details: error instanceof Error ? error.message : String(error),
        stage: 'refresh',
      });
    } finally {
      setPending(undefined);
    }
  };

  const install = async (paths: string[]) => {
    if (!scan || !paths.length || busy.current) return;
    busy.current = true;
    setPending('import');
    setFailure(undefined);
    try {
      const batch = await agentSkillService.importGitHubSkills({
        commit: scan.commit,
        gitUrl: scan.url,
        scope: scan.scope,
        selections: candidates
          .filter((item) => paths.includes(item.path))
          .map(({ path, revision }) => ({ path, revision })),
      });
      setResults((prev) => [...prev.filter((item) => !paths.includes(item.path)), ...batch]);
      setSelected((prev) => prev.filter((path) => !paths.includes(path)));
    } catch (error) {
      setFailure(importFailure(error, 'import'));
      busy.current = false;
      setPending(undefined);
      return;
    }
    busy.current = false;
    await refreshLibrary();
  };

  return {
    candidates,
    discover,
    failure,
    input,
    install,
    loading: !!pending,
    pending,
    refreshLibrary,
    results,
    scan,
    selected,
    setInput,
    setSelected,
    source,
  };
};

export type GithubSkillImportState = ReturnType<typeof useGithubSkillImport>;
