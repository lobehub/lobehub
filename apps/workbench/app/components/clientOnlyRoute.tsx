import { type ComponentType, lazy, Suspense, useSyncExternalStore } from 'react';

import WorkbenchLoading from '../../src/shell/WorkbenchLoading';

const noopSubscribe = () => () => {};

const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

export const clientOnlyRoute = (importFn: () => Promise<{ default: ComponentType }>) => {
  const Component = lazy(importFn);

  return function ClientOnlyRoute() {
    const hydrated = useHydrated();

    if (!hydrated) return <WorkbenchLoading />;

    return (
      <Suspense fallback={<WorkbenchLoading />}>
        <Component />
      </Suspense>
    );
  };
};
