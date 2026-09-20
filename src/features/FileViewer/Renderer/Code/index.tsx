'use client';

import { Center, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';
import NotSupport from '../../NotSupport';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    width: 100%;
    height: 100%;
    padding-inline: 24px 4px;
  `,
}));

interface CodeViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

const CodeViewer = memo<CodeViewerProps>(({ url, fileName }) => {
  const { error, fileData, loading, tooLarge } = useTextFileLoader(url);
  const language = getLanguageFromFilename(fileName);

  if (!loading && fileData === null)
    return (
      <Flexbox>
        {error && <AsyncError error={error} variant={'block'} />}
        <NotSupport fileName={fileName} tooLarge={tooLarge} url={url} />
      </Flexbox>
    );

  return (
    <Flexbox className={styles.page}>
      {!loading && fileData !== null ? (
        <Highlighter language={language} showLanguage={false} variant={'borderless'}>
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
