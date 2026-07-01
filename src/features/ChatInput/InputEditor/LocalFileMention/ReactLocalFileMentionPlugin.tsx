import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import { LocalFileMentionPlugin } from './LocalFileMentionPlugin';
import { LocalFileMentionView } from './LocalFileMentionView';

const ReactLocalFileMentionPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(LocalFileMentionPlugin, {
      decorator: (node) => {
        return <LocalFileMentionView isDirectory={node.isDirectory} name={node.name} />;
      },
    });
  }, [editor]);

  return null;
};

ReactLocalFileMentionPlugin.displayName = 'ReactLocalFileMentionPlugin';

export default ReactLocalFileMentionPlugin;
