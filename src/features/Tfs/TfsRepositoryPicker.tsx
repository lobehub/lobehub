'use client';

import type { TfsRepository } from '@lobechat/types';
import { parseTfsRepository } from '@lobechat/utils/tfs';
import { Button, Flexbox, Input, Select, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { tfsService } from '@/services/tfs';
import { useTfsData } from '@/store/tfs/action';

import { useTfsConnection } from './useTfsConnection';
import { useTfsPickerPages } from './useTfsPickerPages';

export const TfsRepositoryPicker = ({
  onSelect,
  onLeave,
  onClear,
}: {
  onClear: () => void;
  onLeave?: () => void;
  onSelect: (repository: TfsRepository) => void;
}) => {
  const { t } = useTranslation('integration');
  const navigate = useWorkspaceAwareNavigate();
  const status = useTfsConnection();
  const binding = status.connection?.identity?.updatedAt;
  const connected = Boolean(binding);
  const [project, setProject] = useState('');
  const [repository, setRepository] = useState('');
  const [manual, setManual] = useState<TfsRepository>();
  const [branch, setBranch] = useState<string>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const projects = useTfsPickerPages({ binding, kind: 'projects' }, connected);
  const repos = useTfsData(
    { binding, kind: 'repositories', project },
    connected && Boolean(project),
  );
  const branches = useTfsPickerPages(
    { binding, kind: 'branches', project, repository },
    connected && Boolean(repository),
    { autoLoadAll: true },
  );
  const selected = manual ?? repos.data?.repositories?.items.find((r) => r.id === repository);
  const failure = status.error || projects.error || repos.error || branches.error || error;
  const pending = !status.connection && !status.error;

  const resolve = async () => {
    if (!parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)) return;
    setBusy(true);
    setError(undefined);
    try {
      const repo = await tfsService.resolveRepository(url);
      setManual(repo);
      setProject(repo.project.name);
      setRepository(repo.id);
      setBranch(repo.defaultBranch);
      onSelect(repo);
    } catch {
      setError(new Error(t('tfs.resolveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text fontSize={12} type="secondary">
        {t('tfs.personalHint')}
      </Text>
      {failure && (
        <AsyncError
          error={failure}
          onRetry={() => {
            setError(undefined);
            void Promise.all([
              status.revalidate(),
              ...(connected ? [projects.revalidate()] : []),
              ...(project ? [repos.revalidate()] : []),
              ...(repository ? [branches.revalidate()] : []),
            ]);
          }}
        />
      )}
      {pending ? (
        <Text>{t('tfs.loading')}</Text>
      ) : !connected ? (
        status.connection?.configured === false ? (
          <Text type="secondary">{t('tfs.notConfigured')}</Text>
        ) : (
          <Button
            onClick={() => {
              onLeave?.();
              navigate('/settings/integrations/tfs');
            }}
          >
            {t('tfs.connect')}
          </Button>
        )
      ) : (
        <>
          <Select
            showSearch
            aria-label={t('tfs.project')}
            disabled={busy}
            loading={projects.isValidating}
            placeholder={t('tfs.project')}
            value={project || undefined}
            options={projects.items.map((p) => ({ label: p.name, value: p.name }))}
            onChange={(value) => {
              onClear();
              setManual(undefined);
              setProject(String(value ?? ''));
              setRepository('');
              setBranch(undefined);
            }}
          />
          {projects.next && (
            <Button
              size="small"
              loading={projects.isValidating}
              disabled={busy}
              onClick={projects.loadMore}
            >
              {t('tfs.loadMoreProjects')}
            </Button>
          )}
          {(projects.data?.projects?.items.length === 0 ||
            (project && repos.data?.repositories?.items.length === 0)) && (
            <Text type="secondary">{t('tfs.empty')}</Text>
          )}
          {project && (
            <Select
              showSearch
              aria-label={t('tfs.repository')}
              disabled={busy}
              loading={repos.isValidating}
              placeholder={t('tfs.repository')}
              value={repository || undefined}
              options={
                repos.data?.repositories?.items.map((r) => ({ label: r.name, value: r.id })) ?? []
              }
              onChange={(value) => {
                const repo = repos.data?.repositories?.items.find((r) => r.id === value);
                setManual(undefined);
                setRepository(String(value ?? ''));
                setBranch(repo?.defaultBranch);
                if (repo) onSelect(repo);
                else onClear();
              }}
            />
          )}
          {selected && (
            <Select
              showSearch
              aria-label={t('tfs.branch')}
              disabled={busy}
              loading={branches.isValidating}
              placeholder={t('tfs.branch')}
              value={branch ?? selected.defaultBranch}
              options={[
                ...new Set(
                  [branch ?? selected.defaultBranch, ...branches.items.map((b) => b.name)].filter(
                    (name): name is string => !!name,
                  ),
                ),
              ].map((name) => ({ label: name, value: name }))}
              onChange={(value) => {
                setBranch(String(value));
                onSelect({ ...selected, defaultBranch: String(value) });
              }}
            />
          )}
          {selected && branches.truncated && (
            <Button
              size="small"
              loading={branches.isValidating}
              disabled={busy}
              onClick={branches.loadMore}
            >
              {t('tfs.loadMoreBranches')}
            </Button>
          )}
          {selected && (
            <Text fontSize={12} type="secondary">
              {selected.project.name}/{selected.name}
              {branch ? ` · ${branch}` : ''}
            </Text>
          )}
          <Text fontSize={12}>{t('tfs.url')}</Text>
          <Flexbox horizontal gap={8}>
            <Input
              aria-label={t('tfs.url')}
              disabled={busy}
              placeholder={`${status.connection?.collectionUrl}/Project/_git/Repository`}
              value={url}
              aria-invalid={
                Boolean(url) &&
                !parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)
              }
              onChange={(e) => {
                onClear();
                setManual(undefined);
                setRepository('');
                setBranch(undefined);
                setUrl(e.target.value);
              }}
            />
            <Button
              disabled={!parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)}
              loading={busy}
              onClick={() => void resolve()}
            >
              {t('tfs.verify')}
            </Button>
          </Flexbox>
          {url && !parseTfsRepository(url, status.connection?.collectionUrl ?? undefined) && (
            <Text type="danger">{t('tfs.invalidUrl')}</Text>
          )}
        </>
      )}
    </Flexbox>
  );
};
