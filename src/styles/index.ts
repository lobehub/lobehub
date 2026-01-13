import { createGlobalStyle } from 'antd-style';

import antdOverride from './antdOverride';
import global from './global';

const prefixCls = 'ant';

export const GlobalStyle = createGlobalStyle(({ theme }) => [
  global({ prefixCls, token: theme }),
  antdOverride({ prefixCls, token: theme }),
]);

export { shinyTextStyles } from './loading';
export * from './text';
