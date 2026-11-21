'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui/es/Flex/index';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import WorkbenchBrandLink from './WorkbenchBrandLink';

const styles = stylex.create({ cta: { flex: 'none' }, title: { flex: '1', minWidth: '0' } });

interface WorkbenchHeaderProps {
  children?: ReactNode;
}

export const WorkbenchHeader = ({ children }: WorkbenchHeaderProps) => {
  const { t } = useTranslation('verify');

  return (
    <Flexbox horizontal align={'center'} gap={8} width={'100%'}>
      <WorkbenchBrandLink />
      <div {...stylex.props(styles.title)}>{children}</div>
      <Button className={stylex.props(styles.cta).className} href={'/'} type={'primary'}>
        {t('actions.goToApp', { name: BRANDING_NAME })}
      </Button>
    </Flexbox>
  );
};
