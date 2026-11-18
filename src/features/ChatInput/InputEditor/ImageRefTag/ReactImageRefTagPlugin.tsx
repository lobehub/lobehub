import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import { ImageRefTag } from './ImageRefTag';
import { ImageRefTagPlugin } from './ImageRefTagPlugin';

const ReactImageRefTagPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(ImageRefTagPlugin, {
      decorator: (node) => <ImageRefTag number={node.number} src={node.src} />,
    });
  }, [editor]);

  return null;
};

ReactImageRefTagPlugin.displayName = 'ReactImageRefTagPlugin';

export default ReactImageRefTagPlugin;
