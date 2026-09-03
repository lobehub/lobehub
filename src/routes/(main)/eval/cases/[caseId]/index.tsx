'use client';

import { Center } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useEvalStore } from '@/store/eval';
import { isTrpcErrorCode } from '@/utils/trpcError';

import TestCaseDetail from '../../features/TestCaseDetail';

const Page = memo(() => {
  const { t } = useTranslation('eval');
  const { caseId } = useParams<{ caseId: string }>();

  const useFetchTestCase = useEvalStore((s) => s.useFetchTestCase);
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const { data: testCase, error, mutate } = useFetchTestCase(caseId);
  const { data: dataset } = useFetchDatasetDetail(testCase?.datasetId);

  // A deleted or mistyped case id is an absent resource, not a failed request:
  // `getTestCase` throws NOT_FOUND, and AsyncBoundary reads `error` before
  // `isEmpty`, so without this it renders a generic "load failed" page offering
  // a Retry that can never succeed.
  const isMissing = isTrpcErrorCode(error, 'NOT_FOUND');

  return (
    <AsyncBoundary
      data={isMissing ? null : testCase}
      error={isMissing ? undefined : error}
      errorVariant={'page'}
      isEmpty={isMissing || !testCase}
      empty={
        <Center flex={1}>
          <Text type="secondary">{t('testCaseDetail.notFound')}</Text>
        </Center>
      }
      onRetry={() => mutate()}
    >
      {testCase && <TestCaseDetail datasetName={dataset?.name} testCase={testCase} />}
    </AsyncBoundary>
  );
});

Page.displayName = 'EvalTestCaseDetailPage';

export default Page;
