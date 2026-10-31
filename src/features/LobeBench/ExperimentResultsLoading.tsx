import { Alert, Block, Button, Empty, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SkeletonBar from '@/components/Skeleton/Bar';

export const ExperimentResultsLoading = () => {
  const { t } = useTranslation('eval');
  return (
    <Flexbox aria-busy gap={20}>
      <Text role={'status'} type={'secondary'}>
        {t('lobeBench.dashboard.loading')}
      </Text>
      <Flexbox horizontal gap={12} wrap={'wrap'}>
        {[0, 1, 2].map((item) => (
          <Block key={item} padding={14} style={{ flex: 1, minWidth: 200 }} variant={'outlined'}>
            <Flexbox gap={12}>
              <SkeletonBar height={14} width={'45%'} />
              <SkeletonBar height={24} width={'70%'} />
              <SkeletonBar height={14} width={'55%'} />
            </Flexbox>
          </Block>
        ))}
      </Flexbox>
      <Block padding={14} variant={'outlined'}>
        <Flexbox gap={20}>
          {[0, 1, 2].map((item) => (
            <Flexbox gap={8} key={item}>
              <SkeletonBar height={16} width={'70%'} />
              <SkeletonBar height={12} width={'45%'} />
            </Flexbox>
          ))}
        </Flexbox>
      </Block>
    </Flexbox>
  );
};

interface ExperimentResultsStateProps {
  className?: string;
  error?: unknown;
  name?: string | null;
  onRetry: () => void;
  retrying: boolean;
  state: 'error' | 'loading' | 'missingRuns' | 'notFound';
}

export const ExperimentResultsState = ({
  className,
  error,
  name,
  onRetry,
  retrying,
  state,
}: ExperimentResultsStateProps) => {
  const { t } = useTranslation('eval');
  return (
    <Flexbox className={className} flex={1} gap={20}>
      {name && (
        <Text as={'h1'} fontSize={24} weight={600}>
          {name}
        </Text>
      )}
      {state === 'notFound' ? (
        <Empty description={t('lobeBench.dashboard.notFound')} />
      ) : state === 'error' ? (
        <AsyncError
          error={error}
          retrying={retrying}
          title={t('lobeBench.dashboard.loadError')}
          variant={'page'}
          onRetry={onRetry}
        />
      ) : (
        <>
          {state === 'loading' ? (
            <ExperimentResultsLoading />
          ) : (
            <Alert title={t('lobeBench.dashboard.missingRuns')} type={'warning'} />
          )}
          <Flexbox align={'flex-start'}>
            <Button loading={retrying} size={'small'} onClick={onRetry}>
              {t('error.retry', { ns: 'error' })}
            </Button>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
};
