'use client';

import { type PropsWithChildren } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// @lobehub/editor/react re-exports the whole editor runtime (lexical, yjs,
// fuse) and rolldown does not shake it down to the provider, so reach the
// context module by path until the package exposes a provider-only entry.
import { EditorProvider } from '../../../node_modules/@lobehub/editor/es/react/EditorProvider';

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
