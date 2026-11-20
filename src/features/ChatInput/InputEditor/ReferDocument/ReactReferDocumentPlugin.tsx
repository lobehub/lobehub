import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import ReferDocument from './ReferDocument';
import { ReferDocumentPlugin } from './ReferDocumentPlugin';

const ReactReferDocumentPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(ReferDocumentPlugin, {
      decorator: (node) => {
        return <ReferDocument node={node} />;
      },
    });
  }, [editor]);

  return null;
};

ReactReferDocumentPlugin.displayName = 'ReactReferDocumentPlugin';

export default ReactReferDocumentPlugin;
