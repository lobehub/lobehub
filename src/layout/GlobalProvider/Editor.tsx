'use client';

import { EditorProvider } from '@lobehub/editor/react';
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
