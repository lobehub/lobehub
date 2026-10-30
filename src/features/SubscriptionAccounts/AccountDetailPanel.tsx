'use client';

import { ActionIcon, Empty, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import SkeletonBar from '@/components/Skeleton/Bar';
import QuotaCalendar from '@/features/AgentQuotaCalendar/QuotaCalendarModal';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { agentQuotaService } from '@/services/agentQuota';
import type { QuotaAccount } from '@/store/agentQuota';

import { accountDisplayName } from './AccountRow';
import type { SubscriptionProvider } from './accountView';

/** Runs move on quickly; poll while the panel is open so the list stays current. */
const ACTIVE_RUNS_REFRESH_MS = 15_000;

const styles = stylex.create({
  avatar: { position: 'relative', display: 'flex', flex: 'none' },
  runningBadge: {
    position: 'absolute',
    insetInlineEnd: '-3px',
    insetBlockEnd: '-3px',
    display: 'flex',
    padding: '1px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgContainer,
  },
  // Sits beside the list and squeezes it rather than covering it, and stays in
  // view while the list scrolls under the settings header.
  panel: {
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
    flexShrink: 0,
    width: 'min(480px, 40%)',
    maxHeight: 'calc(100vh - 120px)',
    overflowY: 'auto',
    paddingInlineStart: '20px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  run: {
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    cursor: 'pointer',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
});

type Account = QuotaAccount & { provider: SubscriptionProvider };

const ActiveRuns = ({ accountId }: { accountId: string }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const { data, error, isLoading } = useClientDataSWR(
    ['agentQuota.activeRuns', accountId],
    () => agentQuotaService.listActiveRuns(accountId),
    { refreshInterval: ACTIVE_RUNS_REFRESH_MS },
  );

  if (isLoading)
    return (
      <Flexbox gap={4}>
        <SkeletonBar height={44} />
        <SkeletonBar height={44} />
      </Flexbox>
    );
  if (error && !data)
    return (
      <Text fontSize={13} type={'secondary'}>
        {t('subscriptionAccounts.activeRuns.loadFailed')}
      </Text>
    );
  if (!data?.length)
    return (
      <Text fontSize={13} type={'secondary'}>
        {t('subscriptionAccounts.activeRuns.empty')}
      </Text>
    );

  return (
    <Flexbox gap={2}>
      {data.map((run) => (
        <Flexbox
          horizontal
          align={'center'}
          gap={12}
          key={run.operationId}
          role={'link'}
          tabIndex={0}
          {...stylex.props(styles.run)}
          onClick={() =>
            run.agentId &&
            navigate(run.topicId ? `/agent/${run.agentId}/${run.topicId}` : `/agent/${run.agentId}`)
          }
        >
          {/* A run that is executing carries the shared running ring on its
              avatar; a waiting one says so in text on the right. */}
          <span {...stylex.props(styles.avatar)}>
            <AgentAvatar
              agentId={run.agentId}
              avatar={run.agentAvatar}
              background={run.agentBackgroundColor ?? undefined}
              name={run.agentTitle}
              shape={'circle'}
              size={24}
            />
            {run.status === 'running' && (
              <span
                aria-label={t('subscriptionAccounts.activeRuns.running')}
                role={'img'}
                {...stylex.props(styles.runningBadge)}
              >
                <RunningGlyph size={10} />
              </span>
            )}
          </span>
          {/* One line, agent · topic: the pair is what identifies a run. */}
          <Flexbox horizontal align={'baseline'} flex={1} gap={6} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ flex: 'none', maxWidth: '50%' }} weight={500}>
              {run.agentTitle || t('subscriptionAccounts.activeRuns.untitledAgent')}
            </Text>
            <Text style={{ flex: 'none' }} type={'secondary'}>
              ·
            </Text>
            <Text ellipsis type={'secondary'}>
              {run.topicTitle || t('subscriptionAccounts.activeRuns.untitledTopic')}
            </Text>
          </Flexbox>
          {run.status !== 'running' && (
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {t('subscriptionAccounts.activeRuns.waiting')}
            </Text>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

interface AccountDetailPanelProps {
  account: Account;
  onClose: () => void;
}

/**
 * The account's side panel: which agents are spending it right now, then its
 * usage history. It sits beside the list and narrows it instead of covering
 * it, so the admin can step through accounts with the list still in view.
 */
const AccountDetailPanel = ({ account, onClose }: AccountDetailPanelProps) => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');

  return (
    <aside {...stylex.props(styles.panel)}>
      <Flexbox gap={20}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text ellipsis fontSize={16} weight={600}>
            {accountDisplayName(account)}
          </Text>
          <ActionIcon icon={XIcon} size={'small'} title={tCommon('close')} onClick={onClose} />
        </Flexbox>
        <Flexbox gap={8}>
          <Text weight={500}>{t('subscriptionAccounts.activeRuns.title')}</Text>
          <ActiveRuns accountId={account.id} />
        </Flexbox>
        <Flexbox gap={8}>
          <Text weight={500}>{t('subscriptionAccounts.usageTitle')}</Text>
          {account.externalAccountId ? (
            <QuotaCalendar
              externalAccountId={account.externalAccountId}
              provider={account.provider}
            />
          ) : (
            <Empty description={t('subscriptionAccounts.status.noData')} />
          )}
        </Flexbox>
      </Flexbox>
    </aside>
  );
};

export default AccountDetailPanel;
