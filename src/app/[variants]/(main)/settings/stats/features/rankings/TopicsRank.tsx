import { BarList } from '@lobehub/charts';
import { ActionIcon, Icon, Modal } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MaximizeIcon, MessageSquareIcon } from 'lucide-react';
import Link from 'next/link';
import qs from 'query-string';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { INBOX_SESSION_ID } from '@/const/session';
import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { type TopicRankItem } from '@/types/topic';

import StatsFormGroup from '../components/StatsFormGroup';

export const TopicsRank = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { data, isLoading } = useClientDataSWR('rank-topics', async () =>
    topicService.rankTopics(),
  );

  const showExtra = Boolean(data && data?.length > 5);

  const mapData = (item: TopicRankItem) => {
    const link = qs.stringifyUrl({
      query: {
        session: item.sessionId || INBOX_SESSION_ID,
        topic: item.id,
        ...(mobile ? { showMobileWorkspace: true } : {}),
      },
      url: '/agent',
    });
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
        extra={
          showExtra && (
            <ActionIcon icon={MaximizeIcon} onClick={() => setOpen(true)} size={'small'} />
          )
        }
        fontSize={16}
        title={t('stats.topicsRank.title')}
      >
        <BarList
          data={data?.slice(0, 5).map((item) => mapData(item)) || []}
          height={220}
          leftLabel={t('stats.topicsRank.left')}
          loading={isLoading || !data}
          noDataText={{
            desc: t('stats.empty.desc'),
            title: t('stats.empty.title'),
          }}
          onValueChange={(item) => navigate(item.link)}
          rightLabel={t('stats.topicsRank.right')}
        />
      </StatsFormGroup>
      {showExtra && (
        <Modal
          footer={null}
          loading={isLoading || !data}
          onCancel={() => setOpen(false)}
          open={open}
          title={t('stats.topicsRank.title')}
        >
          <BarList
            data={data?.map((item) => mapData(item)) || []}
            height={340}
            leftLabel={t('stats.topicsRank.left')}
            loading={isLoading || !data}
            onValueChange={(item) => navigate(item.link)}
            rightLabel={t('stats.topicsRank.right')}
          />
        </Modal>
      )}
    </>
  );
});

export default TopicsRank;
