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

const getLanguage = (fileName?: string): string => {
  if (!fileName) return 'javascript';
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'ts': {
      return 'typescript';
    }
    case 'tsx': {
      return 'tsx';
    }
    case 'jsx': {
      return 'jsx';
    }
    default: {
      return 'javascript';
    }
  }
};

interface JavaScriptViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

const JavaScriptViewer = memo<JavaScriptViewerProps>(({ url, fileName }) => {
  const { fileData, loading } = useTextFileLoader(url);
  const language = getLanguage(fileName);

  return (
    <Flexbox className={styles.page} id="javascript-renderer">
      {!loading && fileData ? (
        <Highlighter language={language} showLanguage={false} variant={'borderless'}>
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

export default JavaScriptViewer;
