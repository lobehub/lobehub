'use client';

import { Center, Flexbox, Spin } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import AsyncError from '@/components/AsyncError';
import { InlineHtmlPreview } from '@/components/HtmlPreview';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';
import NotSupport from '../../NotSupport';

const styles = stylex.create({ page: { width: '100%', height: '100%', padding: '0' } });

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
    <Flexbox className={stylex.props(styles.page).className}>
      {!loading && fileData !== null ? (
        <InlineHtmlPreview content={fileData} />
      ) : (
        <Center height={'100%'}>
          <Spin size="large" />
        </Center>
      )}
    </Flexbox>
  );
});

HTMLViewer.displayName = 'HTMLViewer';

export default HTMLViewer;
