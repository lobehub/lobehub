declare module 'fixture-ui' {
  import type { ReactNode } from 'react';

  export const Button: (props: { children?: ReactNode; className?: string }) => ReactNode;
  export const Image: (props: { alt?: string; classNames?: { image?: string } }) => ReactNode;
}
