'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

const Container: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader />
      <SettingContainer
        maxWidth={1024}
        padding={24}
        style={{
          minHeight: '100%',
        }}
      >
        {children}
      </SettingContainer>
    </Flexbox>
  );
};
export default Container;
