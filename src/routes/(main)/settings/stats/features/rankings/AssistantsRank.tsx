import { AGENT_CHAT_URL } from '@lobechat/const';
import { BarList } from '@lobehub/charts';
import { ActionIcon, Avatar } from '@lobehub/ui';
import { MaximizeIcon } from 'lucide-react';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ImperativeModal from '@/components/ImperativeModal';
import { DEFAULT_AVATAR } from '@/const/meta';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Link from '@/libs/router/Link';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { type AgentRankItem } from '@/types/agent';

import StatsFormGroup from '../components/StatsFormGroup';

export const AssistantsRank = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['auth', 'chat']);
  const navigate = useWorkspaceAwareNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.rankAgents(), async () =>
    agentService.rankAgents(),
  );

  const showExtra = Boolean(data && data?.length > 5);

  const mapData = (item: AgentRankItem) => {
    const isInbox = item.id === inboxAgentId;
    const path = AGENT_CHAT_URL(item.id, mobile);
    const link = mobile
      ? qs.stringifyUrl({ query: { showMobileWorkspace: true }, url: path })
      : path;

    return {
      icon: (
        <Avatar
          alt={item.title || t('defaultAgent', { ns: 'chat' })}
          avatar={item.avatar || DEFAULT_AVATAR}
          background={item.backgroundColor || undefined}
          size={20}
        />
      ),
      link,
      name: (
        <Link href={link} style={{ color: 'inherit' }}>
          {isInbox
            ? t('inbox.title', { ns: 'chat' })
            : item.title || t('defaultAgent', { ns: 'chat' })}
        </Link>
      ),
      value: item.count,
    };
  };

  return (
    <>
      <StatsFormGroup
        fontSize={16}
        title={t('stats.assistantsRank.title')}
        extra={
          showExtra && (
            <ActionIcon icon={MaximizeIcon} size={'small'} onClick={() => setOpen(true)} />
          )
        }
      >
        <AsyncBoundary data={data} error={error} errorVariant={'block'} onRetry={() => mutate()}>
          <BarList
            data={data?.slice(0, 5).map((item) => mapData(item)) || []}
            height={220}
            leftLabel={t('stats.assistantsRank.left')}
            loading={isLoading || !data}
            rightLabel={t('stats.assistantsRank.right')}
            noDataText={{
              desc: t('stats.empty.desc'),
              title: t('stats.empty.title'),
            }}
            onValueChange={(item) => navigate(item.link)}
          />
        </AsyncBoundary>
      </StatsFormGroup>
      {showExtra && (
        <ImperativeModal
          footer={null}
          loading={isLoading || !data}
          open={open}
          title={t('stats.assistantsRank.title')}
          onCancel={() => setOpen(false)}
        >
          <BarList
            data={data?.map((item) => mapData(item)) || []}
            height={340}
            leftLabel={t('stats.assistantsRank.left')}
            loading={isLoading || !data}
            rightLabel={t('stats.assistantsRank.right')}
            onValueChange={(item) => navigate(item.link)}
          />
        </ImperativeModal>
      )}
    </>
  );
});

export default AssistantsRank;
