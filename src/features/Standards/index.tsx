'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ScaleIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';

import DetailPanel from './DetailPanel';
import { useStandards } from './hooks';
import StandardRow from './StandardRow';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
  `,
}));

/**
 * The rules distilled from the rounds this reviewer sent back.
 *
 * Read-only by construction: every one of these was learned from a rejection, so an "add" button
 * would invite exactly the hand-written rules this replaces. The two things a reader does here are
 * read one and retire one, and both live in the detail panel.
 */
const Standards = () => {
  const { t } = useTranslation('memory');
  const { data, error, isLoading, mutate } = useStandards();
  const [selectedId, setSelectedId] = useState<string>();

  const all = (data?.groups ?? []).flatMap((group) => group.standards);
  const live = all.filter((standard) => standard.status !== 'retired');
  const archived = all.filter((standard) => standard.status === 'retired');
  const selected = all.find((standard) => standard.id === selectedId);
  const isEmpty = !isLoading && !error && all.length === 0;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader />
      <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
        <Flexbox className={styles.body}>
          <WideScreenContainer gap={24} paddingBlock={'24px 64px'}>
            <Flexbox gap={4}>
              <Text fontSize={26} weight={700}>
                {t('rules.title')}
              </Text>
              <Text type={'secondary'}>{t('rules.subtitle')}</Text>
            </Flexbox>
            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'page'}
              isEmpty={isEmpty}
              isLoading={isLoading}
              loading={<Loading debugId={'Standards'} />}
              empty={
                <Empty
                  icon={ScaleIcon}
                  title={t('rules.empty.title')}
                  description={
                    <Flexbox align={'center'} gap={8}>
                      <span>{t('rules.empty.description')}</span>
                      {Boolean(data?.backlogRounds) && (
                        <Text fontSize={13} type={'secondary'}>
                          {t('rules.backlog', { count: data!.backlogRounds })}
                        </Text>
                      )}
                    </Flexbox>
                  }
                />
              }
              onRetry={() => mutate()}
            >
              <Flexbox gap={24}>
                <Flexbox gap={8}>
                  {live.map((standard) => (
                    <StandardRow
                      active={standard.id === selectedId}
                      key={standard.id}
                      standard={standard}
                      onSelect={() => setSelectedId(standard.id)}
                    />
                  ))}
                </Flexbox>
                {archived.length > 0 && (
                  <Flexbox gap={8}>
                    <Text fontSize={13} type={'secondary'}>
                      {t('rules.archivedGroup', { count: archived.length })}
                    </Text>
                    {archived.map((standard) => (
                      <StandardRow
                        active={standard.id === selectedId}
                        key={standard.id}
                        standard={standard}
                        onSelect={() => setSelectedId(standard.id)}
                      />
                    ))}
                  </Flexbox>
                )}
              </Flexbox>
            </AsyncBoundary>
          </WideScreenContainer>
        </Flexbox>
        {all.length > 0 && (
          <DetailPanel
            standard={selected}
            onChanged={() => void mutate()}
            onClose={() => setSelectedId(undefined)}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Standards;
