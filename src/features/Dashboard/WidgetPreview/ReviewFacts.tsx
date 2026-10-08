'use client';

import type { WidgetManifest } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const reviewStyles = createStaticStyles(({ css }) => ({
  label: css`
    flex: none;
    width: 88px;
    color: ${cssVar.colorTextTertiary};
  `,
  section: css`
    padding: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const Fact = ({ label, children }: { children: ReactNode; label: string }) => (
  <Flexbox horizontal align={'baseline'} gap={8}>
    <Text className={reviewStyles.label} fontSize={12}>
      {label}
    </Text>
    <Flexbox horizontal flex={1} gap={4} style={{ minWidth: 0 }} wrap={'wrap'}>
      {children}
    </Flexbox>
  </Flexbox>
);

/** What a version may touch when it runs: the hosts it can reach and the credentials it gets. */
export const AccessFacts = memo<{ manifest?: WidgetManifest | null }>(({ manifest }) => {
  const { t } = useTranslation('dashboard');
  const hosts = manifest?.network?.allow ?? [];
  const env = manifest?.env ?? [];
  // The boolean network format — the deployed Worker's only one — switches
  // egress on for any nonempty allowlist without enforcing the hosts, so the
  // facts must say the script can reach any host, not just the declared ones.
  const enforcesHosts = useServerConfigStore(
    serverConfigSelectors.widgetSandboxEnforcesNetworkHosts,
  );

  return (
    <>
      <Fact label={t('publish.network')}>
        {hosts.length > 0 ? (
          <>
            {!enforcesHosts && (
              <Text fontSize={12} type={'warning'}>
                {t('publish.networkUnrestricted')}
              </Text>
            )}
            {hosts.map((host) => (
              <Tag key={host} size={'small'}>
                {host}
              </Tag>
            ))}
          </>
        ) : (
          <Text fontSize={12}>{t('publish.networkNone')}</Text>
        )}
      </Fact>
      <Fact label={t('publish.env')}>
        {env.length > 0 ? (
          env.map((item) => (
            <Tag key={item.name} size={'small'}>
              {[item.connector ? `${item.name} ← ${item.connector}` : item.name, item.field]
                .filter(Boolean)
                .join(' · ')}
            </Tag>
          ))
        ) : (
          <Text fontSize={12}>{t('publish.envNone')}</Text>
        )}
      </Fact>
    </>
  );
});

AccessFacts.displayName = 'DashboardReviewAccessFacts';

/**
 * The review could not be shown — a request failed, or the version under
 * review is gone. Approval stays held, so say so and offer a retry.
 */
export const ReviewUnavailable = memo<{
  error?: unknown;
  missing?: boolean;
  onRetry: () => void;
}>(({ error, missing, onRetry }) => {
  const { t } = useTranslation('dashboard');
  return (
    <AsyncError
      description={missing ? t('review.versionMissing') : undefined}
      error={error}
      title={t('review.loadFailed')}
      variant={'block'}
      onRetry={onRetry}
    />
  );
});

ReviewUnavailable.displayName = 'DashboardReviewUnavailable';
