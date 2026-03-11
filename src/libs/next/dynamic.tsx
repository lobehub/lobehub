/**
 * dynamic() adapter — replaces next/dynamic with React.lazy + Suspense.
 *
 * Keeps the same call-site API:
 *   const Comp = dynamic(() => import('./Foo'), { loading: () => <Spinner />, ssr: false });
 */

import { type ComponentType, lazy, type ReactNode, Suspense } from 'react';

export interface DynamicOptions<P = NonNullable<unknown>> {
  loading?: ((...args: any[]) => ReactNode) | undefined;
  ssr?: boolean;
}

export type Loader<P = NonNullable<unknown>> = () => Promise<
  { default: ComponentType<P> } | ComponentType<P>
>;

export type LoaderComponent<P = NonNullable<unknown>> = ComponentType<P>;

function dynamic<P = NonNullable<unknown>>(
  loader: Loader<P>,
  options?: DynamicOptions<P>,
): ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const mod = await loader();
    if (typeof mod === 'function') {
      return { default: mod as ComponentType<P> };
    }
    if ('default' in mod) {
      return mod as { default: ComponentType<P> };
    }
    return { default: mod as unknown as ComponentType<P> };
  });

  const DynamicWrapper = (props: P & Record<string, unknown>) => (
    <Suspense fallback={options?.loading?.() ?? null}>
      {/* @ts-ignore */}
      <LazyComponent {...props} />
    </Suspense>
  );

  return DynamicWrapper as ComponentType<P>;
}

export default dynamic;
