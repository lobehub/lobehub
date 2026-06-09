import { BarList } from '@lobehub/charts';
import { ActionIcon, Icon, Modal } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MaximizeIcon, MessageSquareIcon } from 'lucide-react';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Link from '@/libs/router/Link';
import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { type TopicRankItem } from '@/types/topic';

import StatsFormGroup from '../components/StatsFormGroup';

export const TopicsRank = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('auth');
  const navigate = useWorkspaceAwareNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { data, isLoading } = useClientDataSWR('rank-topics', async () =>
    topicService.rankTopics(),
  );

  const showExtra = Boolean(data && data?.length > 5);

  const mapData = (item: TopicRankItem) => {
    // Topics without an agentId fall back to the inbox agent, mirroring the
    // previous `sessionId || INBOX` behavior in the agent-centric model.
    const agentId = item.agentId ?? inboxAgentId;
    const path = agentId ? SESSION_CHAT_TOPIC_URL(agentId, item.id) : '/';
    const link =
      mobile && agentId
        ? qs.stringifyUrl({ query: { showMobileWorkspace: true }, url: path })
        : path;
    return {
      icon: <Icon color={cssVar.colorTextDescription} icon={MessageSquareIcon} size={16} />,
      link,
      name: (
        <Link href={link} style={{ color: 'inherit' }}>
          {item.title}
        </Link>
      ),
      value: item.count,
    };
  };

  return (
    <>
      <StatsFormGroup
        fontSize={16}
        title={t('stats.topicsRank.title')}
        extra={
          showExtra && (
            <ActionIcon icon={MaximizeIcon} size={'small'} onClick={() => setOpen(true)} />
          )
        }
      >
        <BarList
          data={data?.slice(0, 5).map((item) => mapData(item)) || []}
          height={220}
          leftLabel={t('stats.topicsRank.left')}
          loading={isLoading || !data}
          rightLabel={t('stats.topicsRank.right')}
          noDataText={{
            desc: t('stats.empty.desc'),
            title: t('stats.empty.title'),
          }}
          onValueChange={(item) => navigate(item.link)}
        />
      </StatsFormGroup>
      {showExtra && (
        <Modal
          footer={null}
          loading={isLoading || !data}
          open={open}
          title={t('stats.topicsRank.title')}
          onCancel={() => setOpen(false)}
        >
          <BarList
            data={data?.map((item) => mapData(item)) || []}
            height={340}
            leftLabel={t('stats.topicsRank.left')}
            loading={isLoading || !data}
            rightLabel={t('stats.topicsRank.right')}
            onValueChange={(item) => navigate(item.link)}
          />
        </Modal>
      )}
    </>
  );
});

export default TopicsRank;
