'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type PropsWithChildren } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  body: {
    overflow: { 'default': null, ':has(.portal-artifact)': 'hidden' },
    paddingBlockEnd: { 'default': null, ':has(.portal-artifact)': '12px' },
  },
});

const Body = ({ children }: PropsWithChildren) => {
  return (
    <Flexbox
      {...sx([styles.body], 'portal-body')}
      height={'100%'}
      style={{ flex: 1, height: 0, position: 'relative' }}
      width={'100%'}
    >
      {children}
    </Flexbox>
  );
};

export default Body;
