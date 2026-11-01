import { isDesktop } from '@lobechat/const';
import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import { localFileService } from '@/services/electron/localFileService';

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
      // Only the desktop app can stat a path on this machine; elsewhere tags keep name/path only.
      resolveFileStats: isDesktop
        ? (path) => localFileService.getLocalFileStats({ path })
        : undefined,
    });
  }, [editor]);

  return null;
};

ReactLocalFileTagPlugin.displayName = 'ReactLocalFileTagPlugin';

export default ReactLocalFileTagPlugin;
