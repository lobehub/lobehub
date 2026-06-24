'use client';

import debug from 'debug';
import { memo } from 'react';

import { SafeBoundary } from '@/components/ErrorBoundary';
import {
  type DynamicRouteMeta,
  type DynamicRouteMetaProps,
  type RouteMeta,
  type RouteMetaParams,
} from '@/spa/router/routeMeta';

import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';

const log = debug('lobe-client:route-meta');

interface DynamicMetaRunnerProps {
  DynamicMeta?: RouteMeta['DynamicMeta'];
  onResolve: (meta: DynamicRouteMeta) => void;
  params: RouteMetaParams;
}

const EmptyDynamicMeta = memo<DynamicRouteMetaProps>(({ onResolve }) => {
  usePublishDynamicRouteMeta({}, onResolve);

  return null;
});

EmptyDynamicMeta.displayName = 'EmptyDynamicMeta';

const DynamicMetaRunner = memo<DynamicMetaRunnerProps>(({ DynamicMeta, onResolve, params }) => {
  const MetaComponent = DynamicMeta ?? EmptyDynamicMeta;

  return (
    <SafeBoundary
      onError={(error) => {
        log('DynamicMeta threw, falling back to static meta: %O', error);
        onResolve({});
      }}
    >
      <MetaComponent params={params} onResolve={onResolve} />
    </SafeBoundary>
  );
});

DynamicMetaRunner.displayName = 'DynamicMetaRunnerBoundary';

export default DynamicMetaRunner;
