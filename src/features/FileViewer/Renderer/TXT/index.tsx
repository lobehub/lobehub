'use client';

import { Center, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import CircleLoading from '@/components/Loading/CircleLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    width: 100%;
    padding: 24px;
    border-radius: 4px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
}));

interface TXTViewerProps {
  fileId: string;
  url: string | null;
}

const TXTViewer = memo<TXTViewerProps>(({ url }) => {
  const { fileData, loading } = useTextFileLoader(url);

  return (
    <Flexbox className={styles.page} id="txt-renderer">
      {!loading && fileData ? (
        <Highlighter
          language={'txt'}
          showLanguage={false}
          style={{ height: '100%' }}
          variant={'borderless'}
        >
          {fileData}
        </Highlighter>
      ) : (
        <Center height={'100%'}>
          <CircleLoading />
        </Center>
      )}
    </Flexbox>
  );
});

export default TXTViewer;
