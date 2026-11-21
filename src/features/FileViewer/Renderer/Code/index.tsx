'use client';

import { Center, createStaticStyles, Flexbox, Highlighter, Spin } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import AsyncError from '@/components/AsyncError';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';
import NotSupport from '../../NotSupport';
import { formatJsonForPreview } from './formatJson';

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
  const content = useMemo(
    () => (fileData === null ? null : formatJsonForPreview(fileData, language)),
    [fileData, language],
  );

  if (!loading && fileData === null)
    return (
      <Flexbox>
        {error && <AsyncError error={error} variant={'block'} />}
        <NotSupport fileName={fileName} tooLarge={tooLarge} url={url} />
      </Flexbox>
    );

  return (
    <Flexbox className={styles.page}>
      {!loading && content !== null ? (
        <Highlighter language={language} showLanguage={false} variant={'borderless'}>
          {content}
        </Highlighter>
      ) : (
        <Center height={'100%'}>
          <Spin size="large" />
        </Center>
      )}
    </Flexbox>
  );
});

export default CodeViewer;
