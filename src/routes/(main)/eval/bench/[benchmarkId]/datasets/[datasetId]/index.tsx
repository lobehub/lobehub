'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router';

/**
 * Legacy address. A dataset no longer has to belong to a benchmark, so its
 * canonical path cannot carry one; this keeps existing links resolving.
 */
const LegacyDatasetRedirect = memo(() => {
  const { datasetId } = useParams<{ datasetId: string }>();

  return <Navigate replace to={`/eval/datasets/${datasetId}`} />;
});

LegacyDatasetRedirect.displayName = 'EvalLegacyDatasetRedirect';

export default LegacyDatasetRedirect;
