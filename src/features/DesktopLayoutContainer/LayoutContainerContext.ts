import { createContext, type RefObject } from 'react';

export const LayoutContainerContext = createContext<RefObject<HTMLDivElement | null>>({
  current: null,
});
