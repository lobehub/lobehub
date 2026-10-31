'use client';

import type {
  AntigravityQuotaParams,
  AntigravityQuotaSnapshot,
} from '@lobechat/heterogeneous-agents/quota';
import { Flexbox, Progress, Text } from '@lobehub/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { antigravityQuotaService } from '@/services/antigravityQuota';

import { antigravityQuotaCompact, isAntigravityQuotaStale } from './antigravityQuotaView';
import type { QuotaMenuHelpers } from './QuotaMenu';
import QuotaMenu, { createQuotaSourceKey } from './QuotaMenu';

const noWindows = () => [];
const hasBuckets = (quota: AntigravityQuotaSnapshot) =>
  quota.groups.some((group) => group.buckets.length > 0);
const createErrorSnapshot = (): AntigravityQuotaSnapshot => ({
  error: 'Antigravity quota is unavailable',
  errorCode: 'command_failed',
  groups: [],
  provider: 'antigravity',
  status: 'error',
  updatedAt: Date.now(),
});

const AntigravityQuotaGroups = ({
  quota,
  now,
  formatDuration,
}: {
  quota: AntigravityQuotaSnapshot;
} & Pick<QuotaMenuHelpers<AntigravityQuotaSnapshot>, 'formatDuration' | 'now'>) => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox gap={16}>
      {quota.groups.map((group) => (
        <Flexbox gap={8} key={group.name}>
          <Text strong>{group.name}</Text>
          {group.buckets.map((bucket) => {
            const fraction = bucket.remainingFraction;
            const label =
              bucket.name === 'Weekly Limit Remaining'
                ? t('heteroAgent.quota.weekly')
                : bucket.name === 'Five Hour Limit Remaining'
                  ? t('heteroAgent.antigravityQuota.fiveHour')
                  : bucket.name;
            const duration =
              bucket.resetsAt === null ? undefined : formatDuration(bucket.resetsAt - now);
            const value = bucket.disabled
              ? t('heteroAgent.antigravityQuota.disabled')
              : fraction !== null
                ? `${fraction > 0 && fraction < 0.001 ? '<' : ''}${new Intl.NumberFormat(
                    undefined,
                    {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    },
                  ).format(fraction > 0 && fraction < 0.001 ? 0.001 : fraction)}`
                : bucket.remainingAmount !== null
                  ? t('heteroAgent.antigravityQuota.remainingAmount', {
                      amount: bucket.remainingAmount,
                    })
                  : t('heteroAgent.antigravityQuota.unknown');
            return (
              <Flexbox gap={4} key={bucket.id}>
                <Flexbox horizontal gap={8} justify="space-between">
                  <Text>{label}</Text>
                  <Text>{value}</Text>
                </Flexbox>
                {!bucket.disabled && fraction !== null && (
                  <Progress
                    aria-label={`${group.name}: ${label}`}
                    percent={fraction * 100}
                    showInfo={false}
                    size="small"
                  />
                )}
                {bucket.resetsAt !== null && !bucket.disabled && (
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {bucket.resetsAt <= now
                      ? t('heteroAgent.antigravityQuota.resetUnconfirmed')
                      : duration
                        ? t('heteroAgent.quota.resetsIn', { duration })
                        : t('heteroAgent.quota.resetsSoon')}
                  </Text>
                )}
              </Flexbox>
            );
          })}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

/** Reuse quota-panel request ordering, scope isolation, persistence and refresh feedback. */
export const AntigravityQuotaMenu = ({
  command,
  deviceId,
  env,
}: AntigravityQuotaParams & { deviceId?: string }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const sourceKey = createQuotaSourceKey('antigravity', agentId, deviceId, command, env);
  const fetchQuota = useMemo(
    () => (options?: { force?: boolean }) =>
      antigravityQuotaService.getQuota({ command, deviceId, env, force: options?.force }),
    [command, deviceId, env],
  );
  const errorText = (quota: AntigravityQuotaSnapshot) => {
    switch (quota.errorCode) {
      case 'auth_required': {
        return t('heteroAgent.antigravityQuota.authRequired');
      }
      case 'cli_not_found': {
        return t('heteroAgent.antigravityQuota.cliNotFound');
      }
      case 'unsupported_client': {
        return t('heteroAgent.antigravityQuota.unsupported');
      }
      case 'timeout': {
        return t('heteroAgent.antigravityQuota.timeout');
      }
      default: {
        return t('heteroAgent.antigravityQuota.error');
      }
    }
  };
  return (
    <QuotaMenu
      autoRefreshMs={120_000}
      contentWidth={320}
      createErrorSnapshot={createErrorSnapshot}
      fetchQuota={fetchQuota}
      getCompactItems={antigravityQuotaCompact}
      getErrorText={errorText}
      getRefreshErrorText={errorText}
      getUnavailableText={errorText}
      getWindows={noWindows}
      hasExtraData={hasBuckets}
      renderBody={(quota, helpers) => <AntigravityQuotaGroups quota={quota} {...helpers} />}
      sourceKey={sourceKey}
      title={t('heteroAgent.antigravityQuota.title')}
      tooltip={t('heteroAgent.antigravityQuota.tooltip')}
      getStaleNotice={(quota) =>
        isAntigravityQuotaStale(quota, Date.now())
          ? t('heteroAgent.antigravityQuota.stale')
          : undefined
      }
    />
  );
};
