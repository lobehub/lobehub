import { createGlobalStyle } from '@lobehub/ui';

import global from './global';

export const GlobalStyle = createGlobalStyle(() => [global()]);

export { shinyTextStyles } from './loading';
export * from './text';
