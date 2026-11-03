'use client';

// @lobehub/editor/react re-exports the whole editor runtime (lexical, yjs,
// fuse) and rolldown does not shake it down to the provider, so take the
// provider-only entry to keep that runtime off the first screen.
import { EditorProvider } from '@lobehub/editor/react/EditorProvider';
import { type PropsWithChildren } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const Editor = memo<PropsWithChildren>(({ children }) => {
  const {
    i18n: { language, getResourceBundle },
  } = useTranslation('editor');

  const localization = useMemo(() => getResourceBundle(language, 'editor'), [language]);

  return (
    <EditorProvider
      config={{
        locale: localization,
      }}
    >
      {children}
    </EditorProvider>
  );
});

Editor.displayName = 'Editor';

export default Editor;
