import { useLexicalComposerContext } from '@lobehub/editor';
import { $getNodeByKey } from 'lexical';
import { type FC, useLayoutEffect } from 'react';

import { ReferArtboardPlugin } from './ReferArtboardPlugin';
import { ReferArtboardView } from './ReferArtboardView';

const ReactReferArtboardPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(ReferArtboardPlugin, {
      decorator: (node, current) => (
        <ReferArtboardView
          reference={node.reference}
          onRemove={() =>
            current.update(() => $getNodeByKey(node.getKey())?.getParentOrThrow().remove())
          }
        />
      ),
    });
  }, [editor]);

  return null;
};

ReactReferArtboardPlugin.displayName = 'ReactReferArtboardPlugin';

export default ReactReferArtboardPlugin;
