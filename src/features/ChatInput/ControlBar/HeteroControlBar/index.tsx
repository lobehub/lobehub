'use client';

import { isDesktop } from '@lobechat/const';
import {
  type HeterogeneousAgentRuntimeState,
  type HeterogeneousAgentRuntimeStatus,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { createStaticStyles, cssVar, cx, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActivityIcon, CircleAlertIcon, RadioTowerIcon, TimerResetIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ChatInputCredits from '@/business/client/features/ChatInputCredits';
import { SkeletonBar } from '@/components/Skeleton';
import DeviceSwitcher from '@/features/ChatInput/ControlBar/DeviceSwitcher';
import WorkspaceControls from '@/features/ChatInput/ControlBar/WorkspaceControls';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useTopicId } from '@/features/ChatInput/hooks/useTopicId';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { ClaudeCodeQuotaMenu, CodexQuotaMenu, KimiCodeQuotaMenu } from './QuotaMenu';

const styles = createStaticStyles(({ css }) => ({
  // Pinned to the same 28px row as the plain ControlBar so the composer footer
  // keeps its rhythm regardless of which chips render. `flex: none` matters:
  // the bar sits in a column flex parent and would otherwise shrink to the
  // (compact) chips' min-content height.
  bar: css`
    container: runtimebar / inline-size;
    flex: none;

    height: 28px;
    padding-block: 0;
    padding-inline: 4px;
  `,
  fullAccess: css`
    cursor: default;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  // On a narrow bar the "full access" badge collapses to just its icon — the
  // hover tooltip still spells it out. Saves a chunk of horizontal space that
  // the truncating workspace cluster can use instead.
  fullAccessLabel: css`
    @container runtimebar (width < 600px) {
      display: none;
    }
  `,
  sdkRuntime: css`
    cursor: default;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorInfo};
    white-space: nowrap;

    background: color-mix(in srgb, ${cssVar.colorInfoBg} 55%, transparent);
  `,
  sdkRuntimeClosing: css`
    color: ${cssVar.colorTextDescription};
    background: ${cssVar.colorFillQuaternary};
  `,
  sdkRuntimeError: css`
    color: ${cssVar.colorError};
    background: color-mix(in srgb, ${cssVar.colorErrorBg} 55%, transparent);
  `,
  sdkRuntimeIdle: css`
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  sdkRuntimeMonitoring: css`
    color: ${cssVar.colorWarning};
    background: color-mix(in srgb, ${cssVar.colorWarningBg} 55%, transparent);
  `,
  sdkRuntimeStale: css`
    color: ${cssVar.colorWarning};
    background: color-mix(in srgb, ${cssVar.colorWarningBg} 55%, transparent);
  `,
  // Mirror RuntimeConfig: the workspace cluster shrinks then scrolls horizontally
  // (hidden scrollbar) instead of wrapping each chip's text on narrow screens.
  leftGroup: css`
    scrollbar-width: none;
    overflow: auto hidden;
    flex: 1;
    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  rightGroup: css`
    flex: none;
  `,
}));

const visibleSdkRuntimeStates = new Set<HeterogeneousAgentRuntimeState>([
  'starting',
  'running',
  'monitoring',
  'idle',
  'stale',
  'closing',
  'error',
]);

/**
 * Same 28px row as the loaded bar: the workspace / device chip on the left and,
 * on desktop once config is known, the full-access badge on the right. Keeps the
 * composer from jumping while access or agent config resolve.
 */
const HeteroControlBarSkeleton = ({ showRight }: { showRight?: boolean }) => (
  <Flexbox
    aria-busy
    horizontal
    align={'center'}
    className={styles.bar}
    data-testid={'hetero-control-bar-skeleton'}
    gap={4}
    justify={'space-between'}
  >
    <SkeletonBar height={22} radius={4} width={100} />
    {showRight && <SkeletonBar height={22} radius={4} width={80} />}
  </Flexbox>
);

const HeteroControlBar = memo(() => {
  const { t: tChat } = useTranslation('chat');
  const agentId = useAgentId();
  const topicId = useTopicId();
  const { canConfigureResource, isAccessLoading } = useChatInputResourceAccess();
  const [runtimeStatus, setRuntimeStatus] = useState<HeterogeneousAgentRuntimeStatus>();

  useWatchBroadcast('heteroAgentRuntimeStatus', (status) => {
    if (status.transport !== 'claude-sdk') return;
    setRuntimeStatus(status);
  });

  // All hooks must be called unconditionally (Rules of Hooks)
  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  // Effective config = shared row + this member's device override,
  // so the quota badges gate on where THIS member's run actually executes.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });

  const heteroProvider = agencyConfig?.heterogeneousProvider;
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: !!heteroProvider,
    workspaceScoped,
  });
  const isLocalHeteroExecution = executionTarget === 'local';
  // Subscription windows (5h / weekly) only exist when the CLI is signed into
  // a Claude / Codex account. API mode bills the bound provider key instead,
  // so the remaining-quota chip in the corner would be stale or empty.
  const isSubscriptionAuth = (heteroProvider?.authMode ?? 'subscription') === 'subscription';
  const shouldShowApiCredits = heteroProvider?.authMode === 'api';
  // An explicit bound device (including web's device-upgraded "local" pick)
  // samples quota through the gateway; `auto` has no concrete device to ask
  // and the cloud sandbox has no sampler, so both stay quota-less.
  const quotaDeviceId = executionTarget === 'device' ? agencyConfig?.boundDeviceId : undefined;
  const shouldShowClaudeQuota =
    isSubscriptionAuth &&
    heteroProvider?.type === 'claude-code' &&
    (isLocalHeteroExecution || !!quotaDeviceId);
  const shouldShowCodexQuota =
    isSubscriptionAuth &&
    heteroProvider?.type === 'codex' &&
    (isLocalHeteroExecution || !!quotaDeviceId);
  // Kimi Code carries no client-side auth mode: whether the login is a
  // subscription is only knowable from the sampled snapshot, so gate exactly
  // like Claude and let the snapshot's unavailable reason explain the rest.
  const shouldShowKimiCodeQuota =
    isSubscriptionAuth &&
    heteroProvider?.type === 'kimi-code' &&
    (isLocalHeteroExecution || !!quotaDeviceId);

  if (isAccessLoading) return <HeteroControlBarSkeleton />;

  // A can-use collaborator may choose only their execution device; working
  // directory, git, provider quota and runtime details remain author/editor config.
  if (!canConfigureResource) {
    if (!agentId || isLoading) return <HeteroControlBarSkeleton />;
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
        <DeviceSwitcher agentId={agentId} />
        {shouldShowApiCredits && <ChatInputCredits />}
      </Flexbox>
    );
  }

  // On web there's no full-access badge / skeleton — just the workspace
  // controls (the cloud repo switcher is rendered inside WorkspaceControls)
  // plus the Claude quota badge when the run executes on a bound device that
  // can sample it. The CLI model + thinking-effort selector now lives in the
  // input's bottom-left action bar (see HeterogeneousChatInput), not here.
  if (!isDesktop) {
    if (!agentId) return null;
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
        <Flexbox horizontal align={'center'} className={styles.leftGroup} gap={4}>
          <WorkspaceControls alwaysShowWorkspace agentId={agentId} />
        </Flexbox>
        {(shouldShowApiCredits ||
          (shouldShowClaudeQuota && quotaDeviceId) ||
          (shouldShowCodexQuota && quotaDeviceId) ||
          (shouldShowKimiCodeQuota && quotaDeviceId)) && (
          <Flexbox horizontal align={'center'} className={styles.rightGroup} gap={4}>
            {shouldShowApiCredits && <ChatInputCredits />}
            {shouldShowClaudeQuota && quotaDeviceId && (
              <ClaudeCodeQuotaMenu deviceId={quotaDeviceId} env={heteroProvider?.env} />
            )}
            {shouldShowCodexQuota && quotaDeviceId && (
              <CodexQuotaMenu
                command={heteroProvider?.command}
                deviceId={quotaDeviceId}
                env={heteroProvider?.env}
              />
            )}
            {shouldShowKimiCodeQuota && quotaDeviceId && (
              <KimiCodeQuotaMenu deviceId={quotaDeviceId} env={heteroProvider?.env} />
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  }

  if (!agentId || isLoading) return <HeteroControlBarSkeleton showRight />;

  const fullAccessBadge = (
    <div className={styles.fullAccess}>
      <Icon icon={CircleAlertIcon} size={14} />
      <span className={styles.fullAccessLabel}>{tChat('heteroAgent.fullAccess.label')}</span>
    </div>
  );
  const shouldShowSdkRuntime =
    heteroProvider?.type === 'claude-code' &&
    isLocalHeteroExecution &&
    runtimeStatus?.transport === 'claude-sdk' &&
    visibleSdkRuntimeStates.has(runtimeStatus.state);
  const sdkRuntimeClassName =
    runtimeStatus?.state === 'monitoring'
      ? styles.sdkRuntimeMonitoring
      : runtimeStatus?.state === 'idle'
        ? styles.sdkRuntimeIdle
        : runtimeStatus?.state === 'stale'
          ? styles.sdkRuntimeStale
          : runtimeStatus?.state === 'closing'
            ? styles.sdkRuntimeClosing
            : runtimeStatus?.state === 'error'
              ? styles.sdkRuntimeError
              : undefined;
  const sdkRuntimeIcon =
    runtimeStatus?.state === 'monitoring'
      ? RadioTowerIcon
      : runtimeStatus?.state === 'idle' || runtimeStatus?.state === 'closing'
        ? TimerResetIcon
        : ActivityIcon;
  const sdkRuntimeBadge = shouldShowSdkRuntime ? (
    <Tooltip
      title={tChat('heteroAgent.claudeSdkRuntime.tooltip', {
        count: runtimeStatus.activeTasks.length,
        state: tChat(`heteroAgent.claudeSdkRuntime.state.${runtimeStatus.state}`),
      })}
    >
      <div className={cx(styles.sdkRuntime, sdkRuntimeClassName)}>
        <Icon icon={sdkRuntimeIcon} size={14} />
        <span className={styles.fullAccessLabel}>
          {tChat(`heteroAgent.claudeSdkRuntime.state.${runtimeStatus.state}`)}
        </span>
      </div>
    </Tooltip>
  ) : null;

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Flexbox horizontal align={'center'} className={styles.leftGroup} gap={4}>
        <WorkspaceControls alwaysShowWorkspace agentId={agentId} />
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.rightGroup} gap={4}>
        {shouldShowApiCredits && <ChatInputCredits />}
        {shouldShowCodexQuota && (
          <CodexQuotaMenu
            command={heteroProvider?.command}
            deviceId={quotaDeviceId}
            env={heteroProvider?.env}
          />
        )}
        {shouldShowKimiCodeQuota && (
          <KimiCodeQuotaMenu deviceId={quotaDeviceId} env={heteroProvider?.env} />
        )}
        {shouldShowClaudeQuota && (
          <ClaudeCodeQuotaMenu deviceId={quotaDeviceId} env={heteroProvider?.env} />
        )}
        {sdkRuntimeBadge}
        <Tooltip title={tChat('heteroAgent.fullAccess.tooltip')}>{fullAccessBadge}</Tooltip>
      </Flexbox>
    </Flexbox>
  );
});

HeteroControlBar.displayName = 'HeteroControlBar';

export default HeteroControlBar;
