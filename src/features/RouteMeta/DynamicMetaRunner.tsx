'use client';

import debug from 'debug';
import { memo } from 'react';

import { SafeBoundary } from '@/components/ErrorBoundary';
import { type DynamicRouteMetaProps, type RouteMeta } from '@/spa/router/routeMeta';

const log = debug('lobe-client:route-meta');

interface DynamicMetaRunnerProps extends DynamicRouteMetaProps {
  DynamicMeta: NonNullable<RouteMeta['DynamicMeta']>;
}

const DynamicMetaRunner = memo<DynamicMetaRunnerProps>(({ DynamicMeta, onResolve, params }) => (
  <SafeBoundary
    onError={(error) => {
      log('DynamicMeta threw, falling back to static meta: %O', error);
      onResolve({});
    }}
  >
    <DynamicMeta params={params} onResolve={onResolve} />
  </SafeBoundary>
));

DynamicMetaRunner.displayName = 'DynamicMetaRunner';

export default DynamicMetaRunner;
