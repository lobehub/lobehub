import { createGlobalStyle } from '@lobehub/ui';

import global from './global';

const prefixCls = 'ant';

export const GlobalStyle = createGlobalStyle(({ theme }) => [global({ prefixCls, token: theme })]);

export { shinyTextStyles } from './loading';
export * from './text';
