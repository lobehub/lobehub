'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Skeleton, SkeletonText, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalPage from '@/features/Eval/components/EvalPage';
import { useEvalStore } from '@/store/eval';
import { isTrpcErrorCode } from '@/utils/trpcError';

import TestCaseDetail from '.';

/** Shaped like the page: header, then the model results block, then the definition. */
const CaseSkeleton = () => (
  <EvalPage
    header={
      <Flexbox gap={12}>
        <SkeletonText rows={1} width={200} />
        <Skeleton height={28} radius={6} width="60%" />
        <SkeletonText rows={1} width={320} />
      </Flexbox>
    }
  >
    <Flexbox gap={12}>
      <Skeleton height={56} radius={8} width="100%" />
      <Skeleton height={280} radius={8} width="100%" />
    </Flexbox>
    <SkeletonText rows={4} />
  </EvalPage>
);

const Page = memo(() => {
  const { t } = useTranslation('eval');
  const { caseId } = useParams<{ caseId: string }>();

  const useFetchTestCase = useEvalStore((s) => s.useFetchTestCase);
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const { data: testCase, error, isLoading, mutate } = useFetchTestCase(caseId);
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
      isLoading={isLoading}
      loading={<CaseSkeleton />}
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
