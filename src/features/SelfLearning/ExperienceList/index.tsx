'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { DnaIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';

import { useExpertiseOverview } from '../hooks';
import HabitList from '../Portrait/HabitList';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
}));

/**
 * 一个方向的全部经验 —— 画像上的习惯清单会把「已养成」折起来；这里是完整的、不折叠的清单，
 * 供想逐条过一遍的人用。数据和画像同源（同一份 overview），所以两边看到的可靠度一致。
 */
const ExperienceList = memo(() => {
  const { t } = useTranslation('selfLearning');
  const { domainId } = useParams();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { data, error, isLoading, mutate } = useExpertiseOverview(activeAgentId ?? undefined);

  const domain = useMemo(
    () => data?.domains.find((d) => d.id === domainId),
    [data?.domains, domainId],
  );
  const habits = useMemo(
    () => (domain ? domain.lessons.map((l) => ({ ...l, domainId: domain.id })) : []),
    [domain],
  );
  const domainPath =
    activeAgentId && domainId
      ? urlJoin('/agent', activeAgentId, 'self-evolving', domainId)
      : undefined;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb
              agentId={activeAgentId}
              extraItems={[
                <Link key={'domain'} to={domainPath ?? '#'}>
                  {domain?.title ?? '…'}
                </Link>,
                t('experience.title'),
              ]}
              title={
                <Link to={urlJoin('/agent', activeAgentId, 'self-evolving')}>{t('title')}</Link>
              }
            />
          ) : null
        }
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer>
          <AsyncBoundary
            data={data}
            error={error}
            errorVariant={'page'}
            isEmpty={!error && !isLoading && !domain}
            isLoading={isLoading}
            loading={<Loading debugId={'SelfLearningExperience'} />}
            empty={
              <Center height={'100%'} style={{ minHeight: '50vh' }} width={'100%'}>
                <Empty icon={DnaIcon} title={t('experience.notFound')} />
              </Center>
            }
            onRetry={() => mutate()}
          >
            {domain && activeAgentId && (
              <Flexbox gap={20} paddingBlock={'22px 64px'}>
                <Flexbox gap={4}>
                  <Text fontSize={26} weight={700}>
                    {t('experience.title')}
                  </Text>
                  <Text type={'secondary'}>
                    {t('experience.subtitle', { count: habits.length, name: domain.title })}
                  </Text>
                </Flexbox>
                {habits.length === 0 ? (
                  <Empty
                    description={t('experience.emptyDesc')}
                    title={t('experience.emptyTitle')}
                  />
                ) : (
                  <HabitList
                    defaultStableOpen
                    agentId={activeAgentId}
                    habits={habits}
                    onChanged={() => void mutate()}
                  />
                )}
              </Flexbox>
            )}
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

ExperienceList.displayName = 'ExperienceList';

export default ExperienceList;
