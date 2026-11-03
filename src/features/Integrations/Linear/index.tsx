'use client';

import { createStaticStyles, Flexbox, Icon, Skeleton, Text, toast } from '@lobehub/ui';
import { ArrowLeftIcon, BookOpenIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { useAppOrigin } from '@/hooks/useAppOrigin';

import { useLinearIntegration } from '../useLinearIntegration';
import Connections from './Connections';
import { LINEAR_INTEGRATION } from './definition';
import { buildLinearInstallHref } from './installHref';

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
}));

const KNOWN_ERRORS = new Set([
  'access_denied',
  'exchange_failed',
  'invalid_state',
  'missing_code',
  'save_failed',
  'workspace_forbidden',
]);

interface LinearIntegrationProps {
  onBack: () => void;
}

/**
 * The Linear integration page: the connected Linear workspaces. Connecting
 * hands off to the server route that owns the OAuth handshake; Linear sends
 * the user back here with the outcome in the query.
 */
const LinearIntegration = memo<LinearIntegrationProps>(({ onBack }) => {
  const { t, ready } = useTranslation('integration');
  const appOrigin = useAppOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();
  const workspaceId = useActiveWorkspaceId();
  const scope = workspaceSlug ? 'workspace' : 'personal';
  const data = useLinearIntegration();

  useEffect(() => {
    if (typeof window === 'undefined' || !ready) return;
    const url = new URL(window.location.href);
    const installed = url.searchParams.get('installed');
    const error = url.searchParams.get('error');
    const account = url.searchParams.get('account');
    if (!installed && !error) return;

    if (installed === 'ok') toast.success(t('linear.installResult.success', { account }));
    else if (error && KNOWN_ERRORS.has(error)) {
      toast.error(t(`linear.installResult.error.${error}` as any));
    } else if (error) toast.error(t('linear.installResult.error.unknown', { code: error }));

    for (const key of ['installed', 'error', 'account']) url.searchParams.delete(key);
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
  }, [t, ready]);

  if (data.error && data.isInitialLoading) {
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
  }

  const { config, connections } = data;
  const installHref =
    config?.enabled && config.installPath
      ? buildLinearInstallHref(config.installPath, { appOrigin, workspaceId, workspaceSlug })
      : undefined;
  const BrandIcon = LINEAR_INTEGRATION.icon;

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
            {LINEAR_INTEGRATION.name}
          </Text>
          <Text type="secondary">{t('linear.tagline')}</Text>
        </Flexbox>
        <a
          className={styles.docs}
          href={LINEAR_INTEGRATION.docsUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Icon icon={BookOpenIcon} size="small" />
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('linear.docsLink')}
          </Text>
        </a>
      </Flexbox>

      {data.isInitialLoading ? (
        <Skeleton height={96} />
      ) : (
        <Connections
          configured={!!config?.enabled}
          connections={connections}
          installHref={installHref}
          scope={scope}
          onChanged={data.mutate}
        />
      )}
    </Flexbox>
  );
});

LinearIntegration.displayName = 'LinearIntegration';

export default LinearIntegration;
