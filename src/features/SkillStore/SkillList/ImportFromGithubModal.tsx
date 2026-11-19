'use client';

import type { GitHubSkillCandidate } from '@lobechat/types';
import {
  Button,
  Checkbox,
  createModal,
  Flexbox,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { useGithubSkillImport } from './useGithubSkillImport';

const eligible = (item: GitHubSkillCandidate) => item.status === 'new' || item.status === 'update';

const ImportFromGithubContent = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();
  const {
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
  } = useGithubSkillImport();

  useEffect(() => {
    setCanDismissByClickOutside(!loading);
  }, [loading, setCanDismissByClickOutside]);

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

  return (
    <Flexbox gap={12}>
      <Text as="h4">{t('agentSkillModal.github.title')}</Text>
      {failure && (
        <AsyncError
          align="start"
          details={failure.details}
          variant="inline"
          title={t(
            failure.stage === 'find'
              ? 'agentSkillModal.github.findFailed'
              : 'agentSkillModal.github.importFailed',
          )}
        />
      )}
      <Input
        aria-label="GitHub URL"
        disabled={loading}
        placeholder={t('agentSkillModal.github.urlPlaceholder')}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onPressEnter={discover}
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
              <Button disabled={loading} onClick={close}>
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
