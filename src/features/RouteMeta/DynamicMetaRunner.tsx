'use client';

import debug from 'debug';
import { memo, useEffect } from 'react';

import { SafeBoundary } from '@/components/ErrorBoundary';
import { type DynamicRouteMeta, type RouteMeta } from '@/spa/router/routeMeta';

const log = debug('lobe-client:route-meta');

interface DynamicMetaRunnerProps {
  onResolve: (meta: DynamicRouteMeta) => void;
  params: Record<string, string | undefined>;
  useDynamicMeta?: RouteMeta['useDynamicMeta'];
}

const Runner = memo<DynamicMetaRunnerProps>(({ useDynamicMeta, params, onResolve }) => {
  const { avatar, backgroundColor, title } = useDynamicMeta?.(params) ?? {};

  useEffect(() => {
    onResolve({ avatar, backgroundColor, title });
  }, [avatar, backgroundColor, title, onResolve]);

  return null;
});

Runner.displayName = 'DynamicMetaRunner';

const DynamicMetaRunner = memo<DynamicMetaRunnerProps>((props) => (
  <SafeBoundary
    onError={(error) => {
      log('useDynamicMeta threw, falling back to static meta: %O', error);
      props.onResolve({});
    }}
  >
    <Runner {...props} />
  </SafeBoundary>
));

DynamicMetaRunner.displayName = 'DynamicMetaRunnerBoundary';

export default DynamicMetaRunner;
