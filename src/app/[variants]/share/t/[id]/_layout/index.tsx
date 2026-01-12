'use client';

import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import Link from 'next/link';
import { PropsWithChildren, memo } from 'react';
import { Outlet } from 'react-router-dom';

import { ProductLogo } from '@/components/Branding';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100vw;
    min-height: 100vh;
    background: ${token.colorBgLayout};
  `,
  content: css`
    flex: 1;
    width: 100%;
    padding-block: 24px;
    padding-inline: 24px;
  `,
  header: css`
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
}));

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { styles } = useStyles();

  return (
    <Flexbox className={styles.container}>
      <Flexbox align="center" className={styles.header} gap={8} horizontal>
        <Link href="/">
          <ProductLogo size={36} />
        </Link>
      </Flexbox>
      <Flexbox className={styles.content}>{children ?? <Outlet />}</Flexbox>
    </Flexbox>
  );
});

export default ShareTopicLayout;
