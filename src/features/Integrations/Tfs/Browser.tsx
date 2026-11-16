'use client';

import { Button, Flexbox, Input, Select, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { TfsQuery } from '@/services/tfs';
import { useTfsData } from '@/store/tfs/action';

export const TfsBrowser = ({ binding }: { binding: string }) => {
  const { t } = useTranslation('integration');
  const [project, setProject] = useState('');
  const [repository, setRepository] = useState('');
  const [resource, setResource] = useState<NonNullable<TfsQuery['resource']>>('prs');
  const [cursor, setCursor] = useState<string>();
  const [projectCursor, setProjectCursor] = useState<string>();
  const [path, setPath] = useState('');
  const [version, setVersion] = useState('');
  const [logId, setLogId] = useState<number>();
  const [startLine, setStartLine] = useState(0);
  const [selected, setSelected] = useState<string>();
  const projects = useTfsData({ binding, cursor: projectCursor, kind: 'projects' });
  const repos = useTfsData({ binding, kind: 'repositories', project }, Boolean(project));
  const query: TfsQuery = {
    binding,
    cursor,
    kind: 'browse',
    path: path || undefined,
    project,
    repository: repository || undefined,
    resource,
    version: version ? Number(version) : undefined,
  };
  const ready = Boolean(project) && (resource !== 'prs' || Boolean(repository));
  const browse = useTfsData(query, ready);
  const detail = useTfsData(
    { ...query, cursor: undefined, id: Number(selected), kind: 'detail' },
    Boolean(selected) && resource !== 'tfvc',
  );
  const file = useTfsData(
    { binding, kind: 'file', path: selected, project, version: Number(version) },
    Boolean(selected) && resource === 'tfvc' && Boolean(version),
  );
  const log = useTfsData(
    { binding, kind: 'log', project, id: Number(selected), logId, startLine },
    resource === 'builds' && Boolean(selected) && Boolean(logId),
  );
  const failed = [projects, repos, browse, detail, file, log].find((request) => request.error);
  const error = failed?.error;
  const clear = () => {
    setLogId(undefined);
    setStartLine(0);
    setCursor(undefined);
    setSelected(undefined);
  };
  return (
    <Flexbox gap={12}>
      <Text strong>{t('tfs.browser')}</Text>
      <Text type="secondary">{t('tfs.readOnlyHint')}</Text>
      <Select
        showSearch
        aria-label={t('tfs.project')}
        loading={projects.isValidating}
        placeholder={t('tfs.project')}
        value={project || undefined}
        options={
          projects.data?.projects?.items.map((p) => ({ label: p.name, value: p.name })) ?? []
        }
        onChange={(value) => {
          setProject(String(value));
          setRepository('');
          setPath('');
          clear();
        }}
      />
      {projects.data?.projects?.next && (
        <Button size="small" onClick={() => setProjectCursor(projects.data!.projects!.next)}>
          {t('tfs.nextPage')}
        </Button>
      )}
      {project && (
        <>
          <Select
            aria-label={t('tfs.resource')}
            value={resource}
            options={(['prs', 'builds', 'releases', 'tfvc'] as const).map((r) => ({
              label: t(`tfs.${r}`),
              value: r,
            }))}
            onChange={(value) => {
              setResource(value as typeof resource);
              setPath('');
              clear();
            }}
          />
          {(resource === 'prs' || resource === 'builds') && (
            <Select
              showSearch
              aria-label={t('tfs.repository')}
              loading={repos.isValidating}
              placeholder={t('tfs.repository')}
              value={repository || undefined}
              options={
                repos.data?.repositories?.items.map((r) => ({ label: r.name, value: r.id })) ?? []
              }
              onChange={(value) => {
                setRepository(String(value));
                clear();
              }}
            />
          )}
          {resource === 'tfvc' && (
            <>
              <Text>{path || `$/` + project}</Text>
              <Input
                aria-label={t('tfs.changeset')}
                placeholder={t('tfs.changeset')}
                value={version}
                onChange={(e) => {
                  if (/^\d{0,9}$/.test(e.target.value)) {
                    setVersion(e.target.value);
                    setSelected(undefined);
                  }
                }}
              />
              <Button
                size="small"
                onClick={() => {
                  setPath('');
                  clear();
                }}
              >
                {t('tfs.root')}
              </Button>
            </>
          )}
          <Flexbox horizontal gap={8}>
            <Button
              disabled={!ready}
              loading={browse.isValidating}
              size="small"
              onClick={() => void browse.revalidate()}
            >
              {t('tfs.refresh')}
            </Button>
            {cursor && (
              <Button
                size="small"
                onClick={() => {
                  setCursor(undefined);
                  setSelected(undefined);
                }}
              >
                {t('tfs.firstPage')}
              </Button>
            )}
            {browse.data?.read?.next && (
              <Button
                size="small"
                onClick={() => {
                  setCursor(browse.data!.read!.next);
                  setSelected(undefined);
                }}
              >
                {t('tfs.nextPage')}
              </Button>
            )}
          </Flexbox>
        </>
      )}
      {Boolean(error) && <AsyncError error={error} onRetry={() => void failed?.revalidate()} />}
      {ready && !browse.data && !error && <Text>{t('tfs.loading')}</Text>}
      {browse.data?.read?.items.length === 0 && <Text type="secondary">{t('tfs.empty')}</Text>}
      {browse.data?.read?.items.map((item) => (
        <Flexbox gap={4} key={item.id}>
          <Flexbox horizontal align="center" gap={8}>
            <Button
              size="small"
              onClick={() => {
                if (resource === 'tfvc' && item.state === 'folder') {
                  setPath(item.id);
                  setSelected(undefined);
                } else {
                  setSelected(item.id);
                  setLogId(undefined);
                  setStartLine(0);
                }
              }}
            >
              {item.label}
            </Button>
            <Text fontSize={12} type="secondary">
              {item.state}
            </Text>
            {item.url && (
              <Button href={item.url} rel="noopener noreferrer" size="small" target="_blank">
                {t('tfs.open')}
              </Button>
            )}
          </Flexbox>
          {item.detail && (
            <Text fontSize={12} type="secondary">
              {item.detail}
            </Text>
          )}
        </Flexbox>
      ))}
      {selected && resource === 'tfvc' && !version && (
        <Text type="secondary">{t('tfs.versionRequired')}</Text>
      )}
      {selected && detail.isValidating && <Text>{t('tfs.loading')}</Text>}
      {selected &&
        resource !== 'tfvc' &&
        detail.data?.read?.items.map((item) => (
          <Flexbox gap={2} key={item.id}>
            <Text strong>{item.label}</Text>
            <Text>
              {item.id === 'no-checks'
                ? t('tfs.noChecks')
                : item.id.endsWith('-unavailable')
                  ? t('tfs.detailUnavailable')
                  : item.state}
            </Text>
            {item.logId && (
              <Button
                size="small"
                onClick={() => {
                  setLogId(item.logId);
                  setStartLine(0);
                }}
              >
                {t('tfs.logs')}
              </Button>
            )}
            <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.detail}</Text>
          </Flexbox>
        ))}
      {selected && resource === 'builds' && logId && (
        <Flexbox gap={8}>
          <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{log.data?.log}</Text>
          <Button
            disabled={!log.data?.log}
            loading={log.isValidating}
            size="small"
            onClick={() => setStartLine(startLine + 100)}
          >
            {t('tfs.moreLog')}
          </Button>
        </Flexbox>
      )}
      {selected && resource === 'tfvc' && file.data?.file && (
        <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {file.data.file.content}
        </Text>
      )}
    </Flexbox>
  );
};
