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
import { isPageAcceptanceEmbedEnabled, matchesPageAcceptanceEmbed } from './acceptanceEmbed';
import { resolveYjsWebSocketUrl } from './collaborationUrl';
import { resolveCollaborationUser } from './collaborationUser';
import PageRichLinkCard from './PageRichLinkCard';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useSlashItems } from './useSlashItems';

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

const createPageEmbedRule = (iframeTitle: string, enabled: boolean): LinkEmbedRule => ({
  allowBlockCard: true,
  allowCard: true,
  allowIframe: true,
  getCardPayload: getUrlCardPayload,
  getIframePayload: (url) => ({
    src: url,
    title: iframeTitle,
    url,
  }),
  id: 'page-acceptance-embed',
  match: (url) =>
    matchesPageAcceptanceEmbed(
      url,
      typeof window === 'undefined' ? undefined : window.location,
      enabled,
    ),
});

const genericPageCardRule: LinkEmbedRule = {
  allowBlockCard: true,
  allowCard: true,
  getCardPayload: getUrlCardPayload,
  id: 'page-url-metadata',
  match: (url) => /^https?:\/\//.test(url),
};

const createYjsProviderFactory =
  (wsBaseUrl: string): YjsProviderFactory =>
  (id, yjsDocMap) =>
    createWebSocketYjsProvider(id, yjsDocMap, {
      wsBaseUrl,
    });

interface EditorCanvasProps {
  askCopilotTarget?: ComposerTarget;
  placeholder?: string;
  style?: CSSProperties;
}

type EditorPlugins = NonNullable<Parameters<typeof Editor>[0]['plugins']>;

const AnnotationComposer = ({ close, quotedText, submit }: AnnotationComposerContext) => {
  const [text, setText] = useState('');
  const { t } = useTranslation('editor');

  return (
    <Card size="small" style={{ width: 320 }} title={t('annotation.add')}>
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text ellipsis type="secondary">
          {quotedText}
        </Typography.Text>
        <Input.TextArea
          autoFocus
          placeholder={t('annotation.placeholder')}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button
            disabled={!text.trim()}
            type="fill"
            onClick={() => submit({ kind: 'comment', payload: { text: text.trim() } })}
          >
            {t('annotation.submit')}
          </Button>
        </Space>
      </Space>
    </Card>
  );
};

const AnnotationBubble = ({ close, records }: AnnotationBubbleContext) => {
  const { t } = useTranslation('editor');

  return (
    <Card
      size="small"
      style={{ maxWidth: 360, width: 320 }}
      title={t('annotation.title')}
      extra={
        <Button size="small" type="text" onClick={close}>
          {t('annotation.close')}
        </Button>
      }
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        {records.map((record) => {
          const payload = record.payload as { text?: string } | string | null;
          const text =
            typeof payload === 'string'
              ? payload
              : typeof payload?.text === 'string'
                ? payload.text
                : t('annotation.invalidPayload');
          return <Typography.Text key={record.id}>{text}</Typography.Text>;
        })}
      </Space>
    </Card>
  );
};

const EditorCanvas = memo<EditorCanvasProps>(({ askCopilotTarget, placeholder, style }) => {
  const { t } = useTranslation(['editor', 'file', 'ui']);
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
  const collaborationUrl = resolveYjsWebSocketUrl(
    typeof window === 'undefined' ? undefined : window.location,
    process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL,
  );
  const collaborationEnabled = Boolean(collaborationUrl);
  const acceptanceEmbedEnabled = isPageAcceptanceEmbedEnabled();
  const yjsProviderFactory = useMemo(
    () => (collaborationUrl ? createYjsProviderFactory(collaborationUrl) : undefined),
    [collaborationUrl],
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

    if (documentId && collaborationUrl && yjsProviderFactory) {
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
  }, [collaborationUrl, collaborationUser, documentId, editable, yjsProviderFactory]);

  const toolbarItems = useMemo(
    () => [
      ...(askCopilotItem || []),
      {
        icon: MessageSquarePlusIcon,
        key: 'annotation-comment',
        label: t('annotation.toolbar'),
        onClick: () => {
          editor?.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, {
            kind: 'comment',
            payload: null,
          });
        },
      },
    ],
    [askCopilotItem, editor, t],
  );

  const linkPlugin = useMemo(
    () =>
      Editor.withProps(ReactLinkPlugin, {
        defaultToolbarItems: true,
        labels: {
          convertToBlockCard: t('link.convertToBlockCard', { ns: 'editor' }),
          convertToCard: t('link.convertToCard', { ns: 'editor' }),
          convertToIframe: t('link.convertToIframe', { ns: 'editor' }),
          convertToLink: t('link.convertToLink', { ns: 'editor' }),
          convertToSchema: t('link.convertToSchema', { ns: 'editor' }),
        },
        linkEmbedRules: [
          ...(acceptanceEmbedEnabled
            ? [createPageEmbedRule(t('link.iframeTitle', { ns: 'editor' }), acceptanceEmbedEnabled)]
            : []),
          genericPageCardRule,
        ],
        renderLinkCard: (props) => <PageRichLinkCard {...props} />,
      }),
    [acceptanceEmbedEnabled, t],
  );

  return (
    <SharedEditorCanvas
      collaborationEnabled={collaborationEnabled}
      documentId={documentId}
      editable={editable}
      editor={editor}
      extraPlugins={extraPlugins}
      linkPlugin={linkPlugin}
      placeholder={placeholder || t('pageEditor.editorPlaceholder', { ns: 'file' })}
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
