'use client';

import { Center, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import CircleLoading from '@/components/Loading/CircleLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    width: 100%;
    padding: ${cssVar.paddingLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

interface MarkdownViewerProps {
  fileId: string;
  url: string | null;
}

const MarkdownViewer = memo<MarkdownViewerProps>(({ url }) => {
  const { fileData, loading } = useTextFileLoader(url);

  return (
    <Flexbox className={styles.page} id="markdown-renderer">
      {!loading && fileData ? (
        <Highlighter
          copyable={false}
          language={'markdown'}
          showLanguage={false}
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

export default MarkdownViewer;
