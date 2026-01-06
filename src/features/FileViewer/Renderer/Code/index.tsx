'use client';

import { Center, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    width: 100%;
    height: 100%;
    padding-block: 0px;
    padding-inline: 24px 4px;

    background: #0d1117;
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

interface CodeViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

/**
 * Render any code file.
 */
const CodeViewer = memo<CodeViewerProps>(({ url, fileName }) => {
  const { fileData, loading } = useTextFileLoader(url);
  const language = getLanguage(fileName);

  return (
    <Flexbox className={styles.page} id="javascript-renderer">
      {!loading && fileData ? (
        <Highlighter
          language={language}
          showLanguage={false}
          theme="github-dark-default"
          variant={'borderless'}
        >
          {fileData}
        </Highlighter>
      ) : (
        <Center height={'100%'}>
          <NeuralNetworkLoading size={36} />
        </Center>
      )}
    </Flexbox>
  );
});

export default CodeViewer;
