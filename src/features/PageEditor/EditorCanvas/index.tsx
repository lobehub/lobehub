'use client';

import {
  type AnnotationBubbleContext,
  type AnnotationComposerContext,
  createWebSocketYjsProvider,
  type LinkEmbedRule,
  OPEN_ANNOTATION_COMPOSER_COMMAND,
  ReactArtifactPlugin,
  ReactBlockPlugin,
  ReactCollapsiblePlugin,
  ReactLinkPlugin,
  ReactNodePropertiesPlugin,
  ReactTocPlugin,
  ReactYjsPlugin,
  type YjsProviderFactory,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Button } from '@lobehub/ui/base-ui';
import { Card, Input, Space, Typography } from 'antd';
import { MessageSquarePlusIcon } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ComposerTarget } from '@/features/Conversation/types';
import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorStore } from '../store';
import { usePageEditable } from '../usePageEditable';
import { resolveYjsWebSocketUrl } from './collaborationUrl';
import { resolveCollaborationUser } from './collaborationUser';
import PageRichLinkCard from './PageRichLinkCard';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useSlashItems } from './useSlashItems';

const ACCEPTANCE_EMBED_PATH = '/lobe-editor-acceptance-embed.html';
const PAGE_EDITOR_WRAPPER_STYLE: CSSProperties = { overflow: 'visible' };

const getUrlCardPayload = async (url: string) => {
  const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
  const response = await fetch(`/webapi/url-metadata?url=${encodeURIComponent(url)}`, {
    headers: await getBusinessTrpcHeaders(),
  });
  if (!response.ok) throw new Error(`URL metadata request failed with ${response.status}`);
  return (await response.json()) as {
    description?: string;
    icon?: string;
    title?: string;
    url?: string;
  };
};

const pageEmbedRule: LinkEmbedRule = {
  allowBlockCard: true,
  allowCard: true,
  allowIframe: true,
  getCardPayload: getUrlCardPayload,
  getIframePayload: (url) => ({
    src: url,
    title: 'Lobe Editor 内嵌视图',
    url,
  }),
  id: 'page-acceptance-embed',
  match: (url) => {
    try {
      return new URL(url, 'http://localhost').pathname === ACCEPTANCE_EMBED_PATH;
    } catch {
      return false;
    }
  },
};

const genericPageCardRule: LinkEmbedRule = {
  allowBlockCard: true,
  allowCard: true,
  getCardPayload: getUrlCardPayload,
  id: 'page-url-metadata',
  match: (url) => /^https?:\/\//.test(url),
};

const yjsProviderFactory: YjsProviderFactory = (id, yjsDocMap) =>
  createWebSocketYjsProvider(id, yjsDocMap, {
    wsBaseUrl: resolveYjsWebSocketUrl(
      typeof window === 'undefined' ? undefined : window.location,
      process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL,
    ),
  });

interface EditorCanvasProps {
  askCopilotTarget?: ComposerTarget;
  placeholder?: string;
  style?: CSSProperties;
}

type EditorPlugins = NonNullable<Parameters<typeof Editor>[0]['plugins']>;

const AnnotationComposer = ({ close, quotedText, submit }: AnnotationComposerContext) => {
  const [text, setText] = useState('');

  return (
    <Card size="small" style={{ width: 320 }} title="添加评论">
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text ellipsis type="secondary">
          {quotedText}
        </Typography.Text>
        <Input.TextArea
          autoFocus
          placeholder="输入评论内容"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={close}>取消</Button>
          <Button
            disabled={!text.trim()}
            type="fill"
            onClick={() => submit({ kind: 'comment', payload: { text: text.trim() } })}
          >
            提交
          </Button>
        </Space>
      </Space>
    </Card>
  );
};

const AnnotationBubble = ({ close, records }: AnnotationBubbleContext) => (
  <Card
    size="small"
    style={{ maxWidth: 360, width: 320 }}
    title="评论"
    extra={
      <Button size="small" type="text" onClick={close}>
        关闭
      </Button>
    }
  >
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {records.map((record) => {
        const payload = record.payload as { text?: string } | string | null;
        const text =
          typeof payload === 'string' ? payload : payload?.text || JSON.stringify(payload);
        return <Typography.Text key={record.id}>{text}</Typography.Text>;
      })}
    </Space>
  </Card>
);

const EditorCanvas = memo<EditorCanvasProps>(({ askCopilotTarget, placeholder, style }) => {
  const { t } = useTranslation(['file', 'ui']);
  const editable = usePageEditable();

  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);
  const collaborationDisplayName = useUserStore(userProfileSelectors.displayUserName);
  const collaborationUserId = useUserStore(userProfileSelectors.userId);
  const collaborationUser = useMemo(
    () =>
      resolveCollaborationUser({
        displayName: collaborationDisplayName,
        userId: collaborationUserId,
      }),
    [collaborationDisplayName, collaborationUserId],
  );

  const slashItems = useSlashItems();
  const askCopilotItem = useAskCopilotItem(editor, askCopilotTarget);

  const extraPlugins = useMemo(() => {
    const plugins: EditorPlugins = [
      ReactArtifactPlugin,
      Editor.withProps(ReactNodePropertiesPlugin, {
        readOnly: !editable,
        renderAnnotationBubble: (context) => <AnnotationBubble {...context} />,
        renderComposer: (context) => <AnnotationComposer {...context} />,
      }),
      Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 }),
      ReactCollapsiblePlugin,
      ReactTocPlugin,
    ];

    if (documentId) {
      plugins.push(
        Editor.withProps(ReactYjsPlugin, {
          awarenessData: { userId: collaborationUser.userId },
          cursorColor: collaborationUser.color,
          id: documentId,
          providerFactory: yjsProviderFactory,
          username: collaborationUser.name,
        }),
      );
    }

    return plugins;
  }, [collaborationUser, documentId, editable]);

  const toolbarItems = useMemo(
    () => [
      ...(askCopilotItem || []),
      {
        icon: MessageSquarePlusIcon,
        key: 'annotation-comment',
        label: '评论',
        onClick: () => {
          editor?.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, {
            kind: 'comment',
            payload: null,
          });
        },
      },
    ],
    [askCopilotItem, editor],
  );

  const linkPlugin = useMemo(
    () =>
      Editor.withProps(ReactLinkPlugin, {
        defaultToolbarItems: true,
        labels: {
          convertToBlockCard: '转为块级卡片',
          convertToCard: '转为标题卡片',
          convertToIframe: '转为内嵌视图',
          convertToLink: '转回链接',
          convertToSchema: '转为结构化链接',
        },
        linkEmbedRules: [pageEmbedRule, genericPageCardRule],
        renderLinkCard: (props) => <PageRichLinkCard {...props} />,
      }),
    [],
  );

  return (
    <SharedEditorCanvas
      collaborationEnabled
      documentId={documentId}
      editable={editable}
      editor={editor}
      extraPlugins={extraPlugins}
      linkPlugin={linkPlugin}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={editable ? toolbarItems : undefined}
      wrapperStyle={PAGE_EDITOR_WRAPPER_STYLE}
      unsavedChangesGuard={{
        enabled: true,
        message: t('form.unsavedWarning', { ns: 'ui' }),
        title: t('form.unsavedChanges', { ns: 'ui' }),
      }}
    />
  );
});

export default EditorCanvas;
