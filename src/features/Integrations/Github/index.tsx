'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, confirmModal, Skeleton, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowLeftIcon, BookOpenIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { scmService } from '@/services/scm';

import { useGithubIntegration } from '../useGithubIntegration';
import Automation from './Automation';
import Connections from './Connections';
import { GITHUB_INTEGRATION } from './definition';

const RETURN_TO = '/settings/integrations/github';

const styles = createStaticStyles(({ css, cssVar }) => ({
  back: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  docs: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  hero: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  infoBar: css`
    padding-block: 10px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  infoLabel: css`
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
}));

const KNOWN_ERRORS = new Set([
  'exchange_failed',
  'identity_taken',
  'installation_fetch_failed',
  'missing_installation',
  'workspace_forbidden',
]);

interface GithubIntegrationProps {
  onBack: () => void;
}

/**
 * The GitHub integration page: what it does, the connected accounts and the
 * automation switches. In a workspace an info bar also says who enabled it.
 * Connecting hands off to the server route that owns the GitHub handshake;
 * GitHub sends the user back here with the outcome in the query.
 */
const GithubIntegration = memo<GithubIntegrationProps>(({ onBack }) => {
  const { t, ready } = useTranslation('integration');
  const appOrigin = useAppOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();
  const scope = workspaceSlug ? 'workspace' : 'personal';
  const data = useGithubIntegration();

  useEffect(() => {
    if (typeof window === 'undefined' || !ready) return;
    const url = new URL(window.location.href);
    const installed = url.searchParams.get('installed');
    const error = url.searchParams.get('error');
    const account = url.searchParams.get('account');
    const pending = url.searchParams.get('pending');
    if (!installed && !error && !pending) return;

    if (installed === 'ok') toast.success(t('github.installResult.success', { account }));
    else if (installed === 'updated') toast.success(t('github.installResult.updated'));
    else if (error && KNOWN_ERRORS.has(error)) {
      toast.error(t(`github.installResult.error.${error}` as any));
    } else if (error) toast.error(t('github.installResult.error.unknown', { code: error }));

    // An installation that reached the callback without our state (started
    // on github.com) is not bound until the user confirms it here. `pending`
    // is the single-use claim that callback minted, not an installation id;
    // the server only issues one for an installation this user does not
    // already have, so a connected account never reaches this dialog.
    if (pending) {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('github.pending.content', { account: account ?? '' }),
        okText: t('github.pending.confirm'),
        onOk: async () => {
          try {
            const bound = await scmService.connectInstallation({ claim: pending });
            toast.success(t('github.installResult.success', { account: bound.accountLogin }));
            data.mutate();
          } catch {
            toast.error(t('github.pending.failed'));
          }
        },
        title: t('github.pending.title'),
      });
    }

    for (const key of ['installed', 'error', 'account', 'pending']) url.searchParams.delete(key);
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, ready]);

  if (data.error && data.isInitialLoading) {
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
  }

  const { config, identity, installations } = data;
  // Absolute on purpose: on desktop the renderer lives on app://renderer and a
  // relative link never reaches the server route.
  // The callback sends the user back here; inside a workspace that has to be
  // the mirrored path, or they land on the personal surface instead.
  const returnTo = workspaceSlug ? `/${workspaceSlug}${RETURN_TO}` : RETURN_TO;
  const installHref =
    config?.enabled && appOrigin
      ? `${urlJoin(appOrigin, config.installPath)}?returnTo=${encodeURIComponent(returnTo)}`
      : undefined;

  const first = installations.at(-1);
  const BrandIcon = GITHUB_INTEGRATION.icon;

  return (
    <Flexbox gap={24}>
      <span className={styles.back} onClick={onBack}>
        <Icon icon={ArrowLeftIcon} size="small" />
        <Text type="secondary">{t('overview.title')}</Text>
      </span>

      <Flexbox horizontal align="center" gap={16}>
        <span className={styles.hero}>
          <BrandIcon size={32} />
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 20 }}>
            {GITHUB_INTEGRATION.name}
          </Text>
          <Text type="secondary">{t('github.tagline')}</Text>
        </Flexbox>
        <a
          className={styles.docs}
          href={GITHUB_INTEGRATION.docsUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Icon icon={BookOpenIcon} size="small" />
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('github.info.docsLink')}
          </Text>
        </a>
      </Flexbox>

      {scope === 'workspace' && !data.isInitialLoading ? (
        <Block className={styles.infoBar} variant={'filled'}>
          <Flexbox horizontal align="center" gap={32} wrap="wrap">
            {first ? (
              <Flexbox horizontal align="center" gap={10}>
                <Avatar
                  avatar={identity?.avatarUrl ?? first.metadata.accountAvatarUrl ?? undefined}
                  size={24}
                  title={first.installedByExternalLogin ?? first.accountLogin}
                />
                <Flexbox gap={1}>
                  <span className={styles.infoLabel}>{t('github.info.enabledBy')}</span>
                  <Text style={{ fontSize: 13 }}>
                    {first.installedByExternalLogin ?? first.accountLogin} ·{' '}
                    {new Date(first.createdAt).toLocaleDateString()}
                  </Text>
                </Flexbox>
              </Flexbox>
            ) : (
              <Flexbox gap={1}>
                <span className={styles.infoLabel}>{t('github.info.status')}</span>
                <Text style={{ fontSize: 13 }}>
                  {config?.enabled ? t('github.info.notConnected') : t('github.info.notConfigured')}
                </Text>
              </Flexbox>
            )}
          </Flexbox>
        </Block>
      ) : null}

      {data.isInitialLoading ? (
        <Skeleton height={96} />
      ) : (
        <Connections
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

GithubIntegration.displayName = 'GithubIntegration';

export default GithubIntegration;
