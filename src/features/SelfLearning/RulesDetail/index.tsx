'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';

import { useExpertiseDomain, useExpertiseLessons } from '../hooks';
import RuleList from '../RuleList';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
}));

const RulesDetail = memo(() => {
  const { t } = useTranslation('selfLearning');
  const navigate = useNavigate();
  const { domainId } = useParams();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { data, error, isLoading, mutate } = useExpertiseDomain(domainId);
  const { data: lessons } = useExpertiseLessons(domainId);
  const domainPath =
    activeAgentId && domainId
      ? urlJoin('/agent', activeAgentId, 'self-learning', domainId)
      : undefined;

  useEffect(() => {
    if (!isLoading && !error && !data && activeAgentId) {
      navigate(urlJoin('/agent', activeAgentId, 'self-learning'), { replace: true });
    }
  }, [activeAgentId, data, error, isLoading, navigate]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb
              agentId={activeAgentId}
              title={t('title')}
              extraItems={
                data?.domain.title
                  ? [
                      <Link key={'domain'} to={domainPath ?? '#'}>
                        {data.domain.title}
                      </Link>,
                      t('rules.allTitle'),
                    ]
                  : undefined
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
            isLoading={isLoading}
            loading={<Loading debugId={'SelfLearningRules'} />}
            onRetry={() => mutate()}
          >
            {data && (
              <Flexbox gap={16} paddingBlock={'26px 64px'}>
                <Text fontSize={26} weight={700}>
                  {t('rules.allTitle')}
                </Text>
                <RuleList lessons={lessons ?? []} stats={data.lessonStats} />
              </Flexbox>
            )}
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

RulesDetail.displayName = 'RulesDetail';

export default RulesDetail;
