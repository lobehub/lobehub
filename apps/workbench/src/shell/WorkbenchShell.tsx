'use client';

import { ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

import WorkbenchLocale from './WorkbenchLocale';
import WorkbenchTheme from './WorkbenchTheme';

interface WorkbenchShellProps extends PropsWithChildren {
  locale?: string;
  resources?: Record<string, unknown>;
}

const WorkbenchShell = memo<WorkbenchShellProps>(({ children, resources, locale: localeProp }) => {
  const locale =
    localeProp ??
    (typeof document === 'undefined' ? 'en-US' : document.documentElement.lang || 'en-US');

  return (
    <WorkbenchLocale defaultLang={locale} resources={resources}>
      <WorkbenchTheme>
        <TooltipGroup layoutAnimation={false}>
          <StyleProvider speedy={import.meta.env.PROD}>{children}</StyleProvider>
        </TooltipGroup>
        <ModalHost />
        <ToastHost />
      </WorkbenchTheme>
    </WorkbenchLocale>
  );
});

WorkbenchShell.displayName = 'WorkbenchShell';

export default WorkbenchShell;
