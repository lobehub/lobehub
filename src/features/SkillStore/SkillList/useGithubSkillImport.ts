import type { GitHubSkillDiscovery, GitHubSkillOutcome } from '@lobechat/types';
import { useState } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

export interface GithubSkillImportFailure {
  /** Raw message from the server, folded behind "Show details". */
  details: string;
  stage: 'find' | 'import';
}

const detailsOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The scan → select → import state of the GitHub import modal: one request at
 * a time, and a failure kept apart from the per-skill outcomes of a batch.
 */
export const useGithubSkillImport = () => {
  const refresh = useToolStore((s) => s.refreshAgentSkills);
  const { allowed: canCreate } = usePermission('create_content');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<GithubSkillImportFailure>();
  const [url, setUrlValue] = useState('');
  const [query, setQuery] = useState('');
  const [scan, setScan] = useState<GitHubSkillDiscovery>();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<GitHubSkillOutcome[]>([]);

  const candidates = scan?.candidates ?? [];

  /** A scan belongs to the URL it was read from, so editing the URL drops it. */
  const setUrl = (value: string) => {
    setUrlValue(value);
    setScan(undefined);
    setResults([]);
    setFailure(undefined);
  };

  const discover = async () => {
    if (!canCreate || !url.trim() || loading) return;
    setLoading(true);
    setFailure(undefined);
    try {
      const next = await agentSkillService.discoverGitHubSkills(url.trim());
      // A server that predates a field must not take the modal down with it.
      const found = next.candidates ?? [];
      setScan({ ...next, candidates: found });
      setQuery('');
      setResults([]);
      setSelected(found.length === 1 && found[0].status === 'new' ? [found[0].path] : []);
    } catch (err) {
      setFailure({ details: detailsOf(err), stage: 'find' });
    } finally {
      setLoading(false);
    }
  };

  const install = async (paths: string[]) => {
    if (!canCreate || !scan || !paths.length || loading) return;
    setLoading(true);
    setFailure(undefined);
    try {
      const batch = await agentSkillService.importGitHubSkills({
        commit: scan.commit,
        gitUrl: url.trim(),
        scope: scan.scope,
        selections: candidates
          .filter((item) => paths.includes(item.path))
          .map(({ path, revision }) => ({ path, revision })),
      });
      setResults((prev) => [...prev.filter((item) => !paths.includes(item.path)), ...batch]);
      setQuery('');
      await refresh();
    } catch (err) {
      setFailure({ details: detailsOf(err), stage: 'import' });
    } finally {
      setLoading(false);
    }
  };

  return {
    canCreate,
    candidates,
    discover,
    failure,
    install,
    loading,
    query,
    results,
    scan,
    selected,
    setQuery,
    setSelected,
    setUrl,
    url,
  };
};
