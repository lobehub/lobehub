'use client';

import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import ShareLoading from './ShareLoading';

interface ShareNamespaceProps extends PropsWithChildren {
  namespace: 'chat';
}

const ShareNamespace = memo<ShareNamespaceProps>(({ children, namespace }) => {
  const { ready } = useTranslation(namespace);

  if (!ready) {
    return (
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          height: '100dvh',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <ShareLoading />
      </div>
    );
  }

  return children;
});

ShareNamespace.displayName = 'ShareNamespace';

export default ShareNamespace;
