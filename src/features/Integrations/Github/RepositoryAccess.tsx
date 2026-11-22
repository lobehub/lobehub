'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { densityTokens } from '@/styles/density.stylex';

import { IntegrationConnectionsSkeleton } from '../Skeleton';
import { useGithubIntegration } from '../useGithubIntegration';
import Automation from './Automation';
import Connections from './Connections';
import { buildGithubInstallHref } from './installHref';
import { useGithubInstallResult } from './useGithubInstallResult';

const styles = stylex.create({
  infoBar: {
    borderRadius: cssVar.borderRadiusLG,
    paddingBlock: '10px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
  infoLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: '11px',
    fontWeight: 500,
  },
});

/**
 * The GitHub App half of the GitHub connector page: who installed it, on which
 * accounts, and what LobeHub does with the events. A failed lookup costs only
 * this block, never the account connection beside it.
 */
const RepositoryAccess = memo(() => {
  const { t } = useTranslation('integration');
  const appOrigin = useAppOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();
  const workspaceId = useActiveWorkspaceId();
  const scope = workspaceSlug ? 'workspace' : 'personal';
  // The server only lets members and up bind or remove a workspace connection.
  const { allowed: canWrite, reason: blockedReason } = usePermission('create_content');
  const data = useGithubIntegration();
  useGithubInstallResult(data.mutate);

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;

  const { config, identity, installations } = data;
  const installHref =
    canWrite && config?.enabled && config.installPath
      ? buildGithubInstallHref(config.installPath, { appOrigin, workspaceId, workspaceSlug })
      : undefined;
  const first = installations.at(-1);

  return (
    <Flexbox gap={24}>
      {scope === 'workspace' && !data.isInitialLoading ? (
        <Block {...stylex.props(styles.infoBar)} variant={'filled'}>
          <Flexbox horizontal align="center" gap={32} wrap="wrap">
            {first ? (
              <Flexbox horizontal align="center" gap={10}>
                <Avatar
                  avatar={identity?.avatarUrl ?? first.metadata.accountAvatarUrl ?? undefined}
                  size={24}
                  title={first.installedByExternalLogin ?? first.accountLogin}
                />
                <Flexbox gap={1}>
                  <span {...stylex.props(styles.infoLabel)}>{t('github.info.enabledBy')}</span>
                  <Text style={{ fontSize: 13 }}>
                    {first.installedByExternalLogin ?? first.accountLogin} ·{' '}
                    {new Date(first.createdAt).toLocaleDateString()}
                  </Text>
                </Flexbox>
              </Flexbox>
            ) : (
              <Flexbox gap={1}>
                <span {...stylex.props(styles.infoLabel)}>{t('github.info.status')}</span>
                <Text style={{ fontSize: 13 }}>
                  {config?.enabled ? t('github.info.notConnected') : t('github.info.notConfigured')}
                </Text>
              </Flexbox>
            )}
          </Flexbox>
        </Block>
      ) : null}

      {data.isInitialLoading ? (
        <IntegrationConnectionsSkeleton title={t('github.repositoryAccess.title')} />
      ) : (
        <Connections
          blockedReason={blockedReason}
          configured={!!config?.enabled}
          installHref={installHref}
          installations={installations}
          scope={scope}
        />
      )}

      <Automation />
    </Flexbox>
  );
});

RepositoryAccess.displayName = 'GithubRepositoryAccess';

export default RepositoryAccess;
