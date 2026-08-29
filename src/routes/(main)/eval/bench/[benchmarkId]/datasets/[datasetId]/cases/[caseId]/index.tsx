'use client';

import { Center } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useEvalStore } from '@/store/eval';

import TestCaseDetail from '../../../../../../features/TestCaseDetail';

const Page = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId, caseId, datasetId } = useParams<{
    benchmarkId: string;
    caseId: string;
    datasetId: string;
  }>();

  const useFetchTestCase = useEvalStore((s) => s.useFetchTestCase);
  const { data: testCase, error, isLoading, mutate } = useFetchTestCase(caseId);

  return (
    <AsyncBoundary
      data={testCase}
      error={error}
      errorVariant={'page'}
      isEmpty={!testCase}
      isLoading={isLoading}
      empty={
        <Center flex={1}>
          <Text type="secondary">{t('testCaseDetail.notFound')}</Text>
        </Center>
      }
      onRetry={() => mutate()}
    >
      {testCase && (
        <TestCaseDetail benchmarkId={benchmarkId!} datasetId={datasetId!} testCase={testCase} />
      )}
    </AsyncBoundary>
  );
});

Page.displayName = 'EvalTestCaseDetailPage';

export default Page;
