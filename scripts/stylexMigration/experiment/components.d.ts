declare module 'experiment-component:*' {
  import type { ComponentType } from 'react';

  const component: ComponentType<Record<string, unknown>>;
  export const FilePathDisplay: ComponentType<Record<string, unknown>>;
  export default component;
}

declare module '*.css';
