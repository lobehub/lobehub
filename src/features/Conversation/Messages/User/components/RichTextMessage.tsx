import { LexicalRenderer } from '@lobehub/editor/renderer';
import type { SerializedEditorState } from 'lexical';
import type { CSSProperties } from 'react';
import { memo, useMemo } from 'react';

import { ActionTagNode } from '@/features/ChatInput/InputEditor/ActionTag/ActionTagNode';
import { ReferTopicNode } from '@/features/ChatInput/InputEditor/ReferTopic/ReferTopicNode';

interface RichTextMessageProps {
  editorState: unknown;
}

const LINE_HEIGHT = 1.6;
const style: CSSProperties = { '--common-line-height': LINE_HEIGHT } as CSSProperties;
const EXTRA_NODES = [ActionTagNode, ReferTopicNode];

const RichTextMessage = memo<RichTextMessageProps>(({ editorState }) => {
  const value = useMemo(() => {
    if (!editorState || typeof editorState !== 'object') return null;
    if (Object.keys(editorState as Record<string, unknown>).length === 0) return null;
    return editorState as SerializedEditorState;
  }, [editorState]);

  if (!value) return null;

  return <LexicalRenderer extraNodes={EXTRA_NODES} style={style} value={value} variant="chat" />;
});

RichTextMessage.displayName = 'RichTextMessage';

export default RichTextMessage;
