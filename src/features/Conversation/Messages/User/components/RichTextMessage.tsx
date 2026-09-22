import { LexicalRenderer } from '@lobehub/editor/renderer';
import { PreviewGroup } from '@lobehub/ui';
import type { SerializedEditorState } from 'lexical';
import type { CSSProperties } from 'react';
import { memo, useMemo } from 'react';

import { ActionTagNode } from '@/features/ChatInput/InputEditor/ActionTag/ActionTagNode';
import { LocalFileTagNode } from '@/features/ChatInput/InputEditor/LocalFileTag';
import { mentionFilledClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { ReferTopicNode } from '@/features/ChatInput/InputEditor/ReferTopic/ReferTopicNode';

import { downloadPreviewImage } from '../../components/downloadPreviewImage';
import { richTextImageRenderers } from './richTextImageRenderers';

interface RichTextMessageProps {
  editorState: unknown;
  variant?: 'chat' | 'default';
}

const LINE_HEIGHT = 1.6;
const style: CSSProperties = { '--common-line-height': LINE_HEIGHT } as CSSProperties;
const EXTRA_NODES = [ActionTagNode, ReferTopicNode, LocalFileTagNode];
const PREVIEW_OPTIONS = { onDownload: downloadPreviewImage };

const RichTextMessage = memo<RichTextMessageProps>(({ editorState, variant = 'chat' }) => {
  const value = useMemo(() => {
    if (!editorState || typeof editorState !== 'object') return null;
    if (Object.keys(editorState as Record<string, unknown>).length === 0) return null;
    return editorState as SerializedEditorState;
  }, [editorState]);

  if (!value) return null;

  return (
    <PreviewGroup preview={PREVIEW_OPTIONS}>
      <LexicalRenderer
        className={mentionFilledClassName}
        extraNodes={EXTRA_NODES}
        overrides={richTextImageRenderers}
        style={style}
        value={value}
        variant={variant}
      />
    </PreviewGroup>
  );
});

RichTextMessage.displayName = 'RichTextMessage';

export default RichTextMessage;
