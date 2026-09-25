'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import AsyncError from '@/components/AsyncError';
import { InlineHtmlPreview } from '@/components/HtmlPreview';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';
import NotSupport from '../../NotSupport';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    width: 100%;
    height: 100%;
    padding: 0;
  `,
}));

interface HTMLViewerProps {
  fileId: string;
  url: string | null;
}

const HTMLViewer = memo<HTMLViewerProps>(({ url }) => {
  const { error, fileData, loading, tooLarge } = useTextFileLoader(url);

  if (!loading && fileData === null)
    return (
      <Flexbox>
        {error && <AsyncError error={error} variant={'block'} />}
        <NotSupport tooLarge={tooLarge} url={url} />
      </Flexbox>
    );

  return (
    <Flexbox className={styles.page}>
      {!loading && fileData !== null ? (
        <InlineHtmlPreview content={fileData} />
      ) : (
        <Center height={'100%'}>
          <NeuralNetworkLoading size={36} />
        </Center>
      )}
    </Flexbox>
  );
});

HTMLViewer.displayName = 'HTMLViewer';

export default HTMLViewer;
