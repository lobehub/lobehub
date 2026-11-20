import { Button, Flexbox, Icon, Input, Tag, Text, useModalContext } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { densityTokens } from '@/styles/density.stylex';

import { GithubImportRecovery } from './GithubImportRecovery';
import { GithubSkillPicker } from './GithubSkillPicker';
import { canImportCandidate } from './githubSkillSelection';
import type { useGithubSkillImport } from './useGithubSkillImport';

const styles = stylex.create({
  list: {
    maxHeight: 'min(36dvh, 320px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  row: {
    paddingBlock: 10,
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderBlockEndWidth: { 'default': 1, ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

export const GithubImport = ({ state }: { state: ReturnType<typeof useGithubSkillImport> }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const {
    canCreate,
    candidates,
    discover,
    failure,
    install,
    loading,
    pending,
    refreshLibrary,
    results,
    scan,
    selected,
    setUrl,
    url,
  } = state;

  const chosen = candidates.filter((item) => selected.includes(item.path));
  const updates = chosen.filter((item) => item.status === 'update').length;
  const finished = results.length > 0;
  const outcomes = new Map(results.map((item) => [item.path, item.status]));
  const remaining = candidates.some((item) => canImportCandidate(item) && !outcomes.has(item.path));
  const failed = results.filter((item) => item.status === 'failed').map((item) => item.path);
  const hasRetryableFailures = failed.length > 0;
  const failureCount = results.filter((item) =>
    ['failed', 'conflict', 'forbidden'].includes(item.status),
  ).length;
  const error = failure?.recovery ? (
    <GithubImportRecovery recovery={failure.recovery} onConnected={state.resumeAfterConnect} />
  ) : (
    failure && (
      <AsyncError
        align="start"
        details={failure.details}
        retrying={loading}
        variant="inline"
        action={
          scan && failure.stage !== 'refresh' ? (
            <Button disabled={loading || !canCreate} size="small" type="text" onClick={discover}>
              {t('agentSkillModal.github.rescan')}
            </Button>
          ) : undefined
        }
        title={t(
          failure.stage === 'import'
            ? 'agentSkillModal.github.batchFailed'
            : `agentSkillModal.github.${failure.stage}Failed`,
        )}
        onRetry={failure.stage === 'refresh' ? refreshLibrary : undefined}
      />
    )
  );

  if (!scan)
    return (
      <Flexbox gap={20}>
        <Flexbox gap={8}>
          <Input
            aria-label={t('agentSkillModal.github.label')}
            disabled={loading || !canCreate}
            placeholder={t('agentSkillModal.github.example')}
            prefix={<Icon icon={GithubIcon} />}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onPressEnter={discover}
          />
          {error}
        </Flexbox>
        <Flexbox horizontal justify="flex-end">
          <Button
            disabled={!canCreate || !url.trim()}
            loading={loading}
            type="primary"
            onClick={discover}
          >
            {t(loading ? 'agentSkillModal.github.finding' : 'agentSkillModal.github.find')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={GithubIcon} />
        <Text ellipsis={{ tooltip: true }} style={{ flex: 1, minWidth: 0 }} type="secondary">
          {url.trim().replace(/^https?:\/\//i, '')}
        </Text>
        <Button
          disabled={loading}
          loading={pending === 'find'}
          size="small"
          onClick={() => setUrl(url)}
        >
          {t(
            pending === 'find' ? 'agentSkillModal.github.finding' : 'agentSkillModal.github.change',
          )}
        </Button>
      </Flexbox>
      {error}
      {finished ? (
        <>
          <Flexbox horizontal align="center" gap={8} role="status">
            <Icon icon={failureCount ? CircleAlert : CheckCircle2} />
            <Text strong>
              {failureCount
                ? t('agentSkillModal.github.summary', {
                    success: results.length - failureCount,
                    failed: failureCount,
                  })
                : t('agentSkillModal.github.complete', { count: results.length })}
            </Text>
          </Flexbox>
          <Flexbox {...stylex.props(styles.list)}>
            {candidates
              .filter((item) => outcomes.has(item.path))
              .map((item) => (
                <Flexbox gap={4} key={item.path} {...stylex.props(styles.row)}>
                  <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
                    <Text strong wordBreak="break-word">
                      {item.name}
                    </Text>
                    <Tag size="small" style={{ whiteSpace: 'normal' }}>
                      {t(`agentSkillModal.github.status.${outcomes.get(item.path)!}`)}
                    </Tag>
                  </Flexbox>
                  <Text fontSize={12} type="secondary" wordBreak="break-all">
                    {item.path || '/'}
                  </Text>
                </Flexbox>
              ))}
          </Flexbox>
        </>
      ) : candidates.length ? (
        <GithubSkillPicker state={state} />
      ) : (
        <Text role="status" type="secondary">
          {t('agentSkillModal.github.empty')}
        </Text>
      )}
      <Flexbox horizontal align="center" gap={8} justify="flex-end" wrap="wrap">
        {finished ? (
          <>
            {(failureCount > failed.length || remaining) && (
              <Button
                disabled={!canCreate || loading}
                loading={pending === 'find'}
                onClick={discover}
              >
                {t(
                  failureCount > failed.length
                    ? 'agentSkillModal.github.rescan'
                    : 'agentSkillModal.github.chooseMore',
                )}
              </Button>
            )}
            <Button
              disabled={loading || (hasRetryableFailures && !canCreate)}
              loading={hasRetryableFailures && pending === 'import'}
              type="primary"
              onClick={hasRetryableFailures ? () => install(failed) : close}
            >
              {t(hasRetryableFailures ? 'agentSkillModal.github.retry' : 'agentSkillModal.done')}
            </Button>
            {hasRetryableFailures && (
              <Button disabled={loading} onClick={close}>
                {t('agentSkillModal.done')}
              </Button>
            )}
          </>
        ) : candidates.some(canImportCandidate) ? (
          <>
            {updates > 0 && (
              <Text fontSize={13} type="secondary">
                {t('agentSkillModal.github.updates', { count: updates })}
              </Text>
            )}
            <Button
              disabled={!canCreate || loading || !chosen.length}
              loading={pending === 'import'}
              type="primary"
              onClick={() => install(selected)}
            >
              {t(
                pending === 'import'
                  ? 'agentSkillModal.importing'
                  : 'agentSkillModal.github.importSelected',
                {
                  count: chosen.length,
                },
              )}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t('common:close')}</Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};
