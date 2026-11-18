'use client';

import type { GitHubSkillCandidate, GitHubSkillOutcome } from '@lobechat/types';
import {
  Alert,
  Button,
  Checkbox,
  createModal,
  Flexbox,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

type Discovery = Awaited<ReturnType<typeof agentSkillService.discoverGitHubSkills>>;
const eligible = (item: GitHubSkillCandidate) => item.status === 'new' || item.status === 'update';

const ImportFromGithubContent = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();
  const refresh = useToolStore((s) => s.refreshAgentSkills);
  const { allowed: canCreate } = usePermission('create_content');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [scan, setScan] = useState<Discovery>();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<GitHubSkillOutcome[]>([]);

  useEffect(() => {
    setCanDismissByClickOutside(!loading);
  }, [loading, setCanDismissByClickOutside]);

  const candidates = scan?.candidates ?? [];
  const chosen = candidates.filter((item) => selected.includes(item.path));
  const selectedNames = new Set(chosen.map((item) => item.name.toLowerCase()));
  const visible = candidates.filter(({ name, path, description }) =>
    [name, path, description].some((field) =>
      field.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const finished = results.length > 0;
  const failed = results.filter((item) => item.status === 'failed').map((item) => item.path);
  const failureCount = results.filter((item) =>
    ['failed', 'conflict', 'forbidden'].includes(item.status),
  ).length;
  const duplicateNames = new Set<string>();
  const allNames = new Set<string>();
  for (const item of candidates.filter(eligible)) {
    const name = item.name.toLowerCase();
    if (allNames.has(name)) duplicateNames.add(name);
    allNames.add(name);
  }
  const bulk = visible.filter(
    (item) => eligible(item) && !duplicateNames.has(item.name.toLowerCase()),
  );

  const discover = async () => {
    if (!canCreate || !url.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const next = await agentSkillService.discoverGitHubSkills(url.trim());
      setScan(next);
      setQuery('');
      setResults([]);
      setSelected(
        next.candidates.length === 1 && next.candidates[0].status === 'new'
          ? [next.candidates[0].path]
          : [],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const install = async (paths: string[]) => {
    if (!canCreate || !scan || !paths.length || loading) return;
    setLoading(true);
    setError('');
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text as="h4">{t('agentSkillModal.github.title')}</Text>
      {error && <Alert showIcon title={error} type="error" />}
      <Input
        aria-label="GitHub URL"
        disabled={loading}
        placeholder={t('agentSkillModal.github.urlPlaceholder')}
        value={url}
        onPressEnter={discover}
        onChange={(event) => {
          setUrl(event.target.value);
          setScan(undefined);
          setResults([]);
          setError('');
        }}
      />
      {!scan && (
        <>
          <Text type="secondary">{t('agentSkillModal.github.collectionHint')}</Text>
          <Button
            disabled={!canCreate || !url.trim()}
            loading={loading}
            type="primary"
            onClick={discover}
          >
            {t('agentSkillModal.github.find')}
          </Button>
        </>
      )}
      {scan && (
        <>
          {finished && (
            <Text role="status">
              {t('agentSkillModal.github.summary', {
                success: results.length - failureCount,
                failed: failureCount,
              })}
            </Text>
          )}
          {!finished && candidates.length > 1 && (
            <>
              <Input
                aria-label={t('agentSkillModal.github.search')}
                placeholder={t('agentSkillModal.github.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Flexbox horizontal gap={8}>
                <Button
                  disabled={loading || !bulk.length}
                  size="small"
                  onClick={() =>
                    setSelected([...new Set([...selected, ...bulk.map((item) => item.path)])])
                  }
                >
                  {t('agentSkillModal.github.select')}
                </Button>
                <Button
                  disabled={loading || !selected.length}
                  size="small"
                  onClick={() => setSelected([])}
                >
                  {t('agentSkillModal.github.clear')}
                </Button>
              </Flexbox>
            </>
          )}
          <Flexbox gap={12} style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            {!visible.length && (
              <Text>
                {t(
                  candidates.length
                    ? 'agentSkillModal.github.noMatch'
                    : 'agentSkillModal.github.empty',
                )}
              </Text>
            )}
            {visible.map((item) => {
              const result = results.find((row) => row.path === item.path);
              if (finished && !result) return null;
              const checked = selected.includes(item.path);
              const duplicate = duplicateNames.has(item.name.toLowerCase());
              return (
                <Flexbox gap={2} key={item.path}>
                  <Flexbox horizontal align="center" gap={8}>
                    {!finished && (
                      <Checkbox
                        aria-label={item.name + ' ' + (item.path || '/')}
                        checked={checked}
                        disabled={
                          loading ||
                          !eligible(item) ||
                          (!checked && selectedNames.has(item.name.toLowerCase()))
                        }
                        onChange={() =>
                          setSelected(
                            checked
                              ? selected.filter((path) => path !== item.path)
                              : [...selected, item.path],
                          )
                        }
                      />
                    )}
                    <Text strong>{item.name}</Text>
                    <Text type="secondary">
                      {t(`agentSkillModal.github.status.${result?.status ?? item.status}`)}
                    </Text>
                  </Flexbox>
                  <Text type="secondary">{item.path || '/'}</Text>
                  {item.description && <Text>{item.description}</Text>}
                  {duplicate && !finished && (
                    <Text type="secondary">{t('agentSkillModal.github.sameName')}</Text>
                  )}
                </Flexbox>
              );
            })}
          </Flexbox>
          {finished ? (
            <Flexbox horizontal gap={8}>
              <Button disabled={loading} onClick={discover}>
                {t('agentSkillModal.github.find')}
              </Button>
              {failed.length > 0 && (
                <Button loading={loading} onClick={() => install(failed)}>
                  {t('agentSkillModal.github.retry')}
                </Button>
              )}
              <Button disabled={loading} type="primary" onClick={close}>
                {t('common:close')}
              </Button>
            </Flexbox>
          ) : (
            <Button
              disabled={!canCreate || !chosen.length}
              loading={loading}
              type="primary"
              onClick={() => install(selected)}
            >
              {t('agentSkillModal.github.install', {
                count: chosen.length,
                updates: chosen.filter((item) => item.status === 'update').length,
              })}
            </Button>
          )}
        </>
      )}
    </Flexbox>
  );
});

ImportFromGithubContent.displayName = 'ImportFromGithubContent';

export const openImportFromGithubModal = (): ModalInstance =>
  createModal({
    content: <ImportFromGithubContent />,
    footer: null,
    maskClosable: true,
    width: 520,
  });
