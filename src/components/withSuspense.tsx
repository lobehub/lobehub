import { type ComponentType } from 'react';
import { Suspense } from 'react';

// @ts-ignore
export const withSuspense: <T>(Comp: T) => T = (Component: ComponentType<any>) => (props: any) => (
  <Suspense>
    <Component {...props} />
  </Suspense>
);
