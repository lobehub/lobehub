'use client';

import { Block, Empty, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';

import { useExpertiseDomain, useExpertiseLesson } from '../hooks';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  sections: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 800px) {
      grid-template-columns: 1fr;
    }
  `,
}));

const SECTION_LABELS = {
  breaks: 'rules.section.breaks',
  correct: 'rules.section.correct',
  dont: 'rules.section.dont',
  good: 'rules.section.good',
  how: 'rules.section.how',
  limits: 'rules.section.limits',
  rule: 'rules.section.rule',
  why: 'rules.section.why',
  works: 'rules.section.works',
  wrong: 'rules.section.wrong',
} as const;

const LessonDetail = memo(() => {
  const { t } = useTranslation('selfLearning');
  const { domainId, lessonId } = useParams();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { data: domain } = useExpertiseDomain(domainId);
  const { data, error, isLoading, mutate } = useExpertiseLesson(lessonId);
  const domainPath =
    activeAgentId && domainId
      ? urlJoin('/agent', activeAgentId, 'self-learning', domainId)
      : undefined;
  const rulesPath = domainPath ? urlJoin(domainPath, 'rules') : undefined;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb
              agentId={activeAgentId}
              title={t('title')}
              extraItems={[
                <Link key={'domain'} to={domainPath ?? '#'}>
                  {domain?.domain.title ?? '…'}
                </Link>,
                <Link key={'rules'} to={rulesPath ?? '#'}>
                  {t('rules.allTitle')}
                </Link>,
                data?.lesson.code ?? '…',
              ]}
            />
          ) : null
        }
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer>
          <AsyncBoundary
            data={data}
            empty={<Empty title={t('rules.detail.notFound')} />}
            error={error}
            errorVariant={'page'}
            isEmpty={!error && !isLoading && !data}
            isLoading={isLoading}
            loading={<Loading debugId={'SelfLearningLesson'} />}
            onRetry={() => mutate()}
          >
            {data && (
              <Flexbox gap={24} paddingBlock={'26px 64px'}>
                <Flexbox gap={8}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Tag>{data.lesson.code}</Tag>
                    {data.lesson.layer && <Tag>{data.lesson.layer}</Tag>}
                  </Flexbox>
                  <Text fontSize={26} lineHeight={1.35} weight={700}>
                    {data.lesson.title}
                  </Text>
                  <Text fontSize={12.5} type={'secondary'}>
                    {t('rules.detail.meta', {
                      hits: data.lesson.hitCount,
                      runs: data.lesson.hitRunCount,
                    })}
                  </Text>
                </Flexbox>

                <div className={styles.sections}>
                  {data.lesson.sections.map((section) => (
                    <Block gap={7} key={section.key} padding={16} variant={'outlined'}>
                      <Text fontSize={12} type={'secondary'} weight={600}>
                        {t(SECTION_LABELS[section.key as keyof typeof SECTION_LABELS])}
                      </Text>
                      <Text fontSize={14} lineHeight={1.75}>
                        {section.body}
                      </Text>
                    </Block>
                  ))}
                </div>

                <Flexbox gap={10}>
                  <Text fontSize={15} weight={600}>
                    {t('rules.detail.examples')}
                  </Text>
                  {data.hits.length === 0 ? (
                    <Empty description={t('rules.detail.noExamples')} />
                  ) : (
                    data.hits.map((hit, index) => (
                      <Block
                        gap={6}
                        key={`${hit.createdAt}-${index}`}
                        padding={14}
                        variant={'outlined'}
                      >
                        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                          <Tag color={hit.outcome === 'pass' ? 'green' : 'red'}>
                            {t(`rules.detail.outcome.${hit.outcome}`)}
                          </Tag>
                          <Text fontSize={11} type={'secondary'}>
                            {hit.runTitle ?? `#${hit.runIndex}`}
                          </Text>
                        </Flexbox>
                        <Text fontSize={13} lineHeight={1.65}>
                          {hit.example}
                        </Text>
                        {hit.note && (
                          <Text fontSize={12} type={'secondary'}>
                            {hit.note}
                          </Text>
                        )}
                      </Block>
                    ))
                  )}
                </Flexbox>
              </Flexbox>
            )}
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

LessonDetail.displayName = 'LessonDetail';

export default LessonDetail;
