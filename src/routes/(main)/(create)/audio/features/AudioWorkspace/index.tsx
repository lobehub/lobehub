'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import ConfigPanel from '../ConfigPanel';
import GenerationFeed from '../GenerationFeed';

const useStyles = createStaticStyles(({ css, token }) => ({
  sidebar: css`
    width: 260px;
    min-width: 260px;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    overflow-y: auto;
  `,
  feed: css`
    flex: 1;
    overflow-y: auto;
    background: ${token.colorBgLayout};
  `,
}));

const AudioWorkspace = memo(() => {
  const { styles } = useStyles();

  return (
    <Flexbox height="100%" horizontal>
      <div className={styles.sidebar}>
        <ConfigPanel />
      </div>
      <div className={styles.feed}>
        <GenerationFeed />
      </div>
    </Flexbox>
  );
});

AudioWorkspace.displayName = 'AudioWorkspace';

export default AudioWorkspace;
