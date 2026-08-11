'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { StyleSheet } from '@/utils/styles';

import DomainDetail from './DomainDetail';
import DomainRail from './DomainRail';
import { useExpertiseOverview } from './hooks';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },
  detail: {
    overflowY: 'auto',
  },
});

/**
 * 自进化 —— 一个 agent 从实习到成熟的看板。
 *
 * 左栏是它在长的几个专长，右侧是选中那个的完整状态：学习曲线、分层覆盖、规则库。
 * 刻意不做成「先选专长再点进详情」的两跳：早期原型那样要点很多次，而这套东西
 * 的价值恰恰在一眼看到「它现在长到哪儿了」。
 */
const SelfLearning = memo(() => {
  const { t } = useTranslation('selfLearning');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { data, error, isLoading, mutate } = useExpertiseOverview(activeAgentId ?? undefined);

  const [activeDomainId, setActiveDomainId] = useState<string>();

  const domains = useMemo(() => data?.domains ?? [], [data]);
  useEffect(() => {
    if (!activeDomainId && domains.length > 0) setActiveDomainId(domains[0].id);
  }, [activeDomainId, domains]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={activeAgentId ? <AgentBreadcrumb agentId={activeAgentId} title={t('title')} /> : null}
        styles={{ left: { paddingInlineStart: 24 } }}
      />
      <Flexbox horizontal flex={1} style={styles.body} width={'100%'}>
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'page'}
          isEmpty={!error && domains.length === 0}
          isLoading={isLoading}
          loading={<Loading debugId="SelfLearning" />}
          empty={
            <Flexbox align={'center'} gap={8} paddingBlock={64} width={'100%'}>
              <Text weight={600}>{t('empty.title')}</Text>
              <Text fontSize={13} style={{ maxWidth: 420, textAlign: 'center' }} type={'secondary'}>
                {t('empty.desc')}
              </Text>
            </Flexbox>
          }
          onRetry={() => mutate()}
        >
          <DomainRail activeId={activeDomainId} domains={domains} onSelect={setActiveDomainId} />
          <Flexbox flex={1} style={styles.detail}>
            <WideScreenContainer>
              {activeDomainId && <DomainDetail domainId={activeDomainId} />}
            </WideScreenContainer>
          </Flexbox>
        </AsyncBoundary>
      </Flexbox>
    </Flexbox>
  );
});

SelfLearning.displayName = 'SelfLearning';

export default SelfLearning;
