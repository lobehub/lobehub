import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import { LocalFileTag } from './LocalFileTag';
import { LocalFileTagPlugin } from './LocalFileTagPlugin';

const ReactLocalFileTagPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(LocalFileTagPlugin, {
      decorator: (node, lexicalEditor) => {
        return (
          <LocalFileTag
            editor={lexicalEditor}
            nodeKey={node.getKey()}
            file={{
              isDirectory: node.isDirectory,
              name: node.name,
              path: node.path,
            }}
          />
        );
      },
    });
  }, [editor]);

  return null;
};

ReactLocalFileTagPlugin.displayName = 'ReactLocalFileTagPlugin';

export default ReactLocalFileTagPlugin;
