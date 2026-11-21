'use client';

import { css, cx, Flexbox } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';

import { densityVars } from '@/styles/densityVars';

const body = css`
  :has(.portal-artifact) {
    overflow: hidden;
    padding-block-end: ${densityVars.contentGap};
  }
`;

const Body = ({ children }: PropsWithChildren) => {
  return (
    <Flexbox
      className={cx(body, 'portal-body')}
      height={'100%'}
      style={{ flex: 1, height: 0, position: 'relative' }}
      width={'100%'}
    >
      {children}
    </Flexbox>
  );
};

export default Body;
