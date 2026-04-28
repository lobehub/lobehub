'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Navigate } from 'react-router-dom';

import { toToolsetPath, useDevtoolsEntries } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    flex: 1;
    align-items: center;
    justify-content: center;

    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const DevtoolsIndex = () => {
  const { defaultToolset } = useDevtoolsEntries();

  if (defaultToolset) {
    return <Navigate replace to={toToolsetPath(defaultToolset.identifier)} />;
  }

  return <Flexbox className={styles.empty}>No builtin tool renders registered.</Flexbox>;
};

export default DevtoolsIndex;
