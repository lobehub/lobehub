declare module 'virtual:lobehub/antd-static-css' {
  export const css: string;
  export const href: string;
  export const styleKeys: string[];
}

declare module 'virtual:lobehub/theme-vars-css' {
  export const css: string;
  export const href: string;
}

declare module 'virtual:react-router/server-build' {
  import type { ServerBuild } from 'react-router';

  const build: ServerBuild;
  export = build;
}
