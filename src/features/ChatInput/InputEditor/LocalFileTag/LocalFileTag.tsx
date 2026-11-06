import { isDesktop } from '@lobechat/const';
import { Button, cx, Flexbox, Icon, Popover, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LexicalEditor } from 'lexical';
import { $createNodeSelection, $setSelection, CLICK_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { ExternalLink, EyeIcon, FolderOpen } from 'lucide-react';
import type { ComponentPropsWithRef, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { localFileService } from '@/services/electron/localFileService';
import type { LocalFilePreview } from '@/services/projectFile';
import { projectFileService } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { parseLocalFileHref } from '../../../Conversation/Markdown/plugins/LocalFileLink/parse';
import { getFileExtension } from '../MentionMenu/localFileDisplay';

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

const styles = stylex.create({
  actionBar: { flexWrap: 'wrap', maxWidth: '320px' },
  label: {
    overflow: 'hidden',
    alignSelf: 'baseline',
    minWidth: '0',
    fontWeight: 400,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  path: {
    maxWidth: '360px',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-all',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  popover: { maxWidth: '392px' },
  previewFrame: {
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'min(360px, 72vw)',
    maxHeight: '240px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  previewImage: { display: 'block', maxWidth: '100%', maxHeight: '240px', objectFit: 'contain' },
  // `.selected` is added by the editor's selection observer, so it is matched as a
  // same-element class.
  tag: {
    cursor: 'default',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    boxSizing: 'border-box',
    maxWidth: 'min(240px, 100%)',
    height: '24px',
    // TAG_MARGIN_INLINE_END (../constants) — StyleX cannot fold an imported constant.
    marginInlineEnd: '4px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    fontSize: 'inherit',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    verticalAlign: 'baseline',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineStyle: { 'default': null, ':is(.selected)': 'solid' },
    outlineWidth: { 'default': null, ':is(.selected)': '2px' },
    outlineColor: { 'default': null, ':is(.selected)': cssVar.colorInfo },
    outlineOffset: { 'default': null, ':is(.selected)': '1px' },
  },
  thumbnail: {
    flexShrink: 0,
    width: '16px',
    height: '16px',
    borderRadius: cssVar.borderRadiusXS,
    objectFit: 'cover',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    boxShadow: `inset 0 0 0 1px ${cssVar.colorFillSecondary}`,
  },
});

export interface LocalFileTagData {
  isDirectory?: boolean;
  name: string;
  path: string;
}

export interface LocalFileTagProps {
  className?: string;
  editor?: LexicalEditor;
  file: LocalFileTagData;
  nodeKey?: string;
}

interface LocalFileTagTriggerProps extends Omit<
  ComponentPropsWithRef<'span'>,
  'children' | 'className' | 'title'
> {
  children: ReactNode;
  className?: string;
  editor?: LexicalEditor;
  nodeKey?: string;
  title?: string;
}

const isPreviewableImageFile = (file: LocalFileTagData) =>
  !file.isDirectory && PREVIEWABLE_IMAGE_EXTENSIONS.has(getFileExtension(file.name || file.path));

const stopActionPropagation = (event: ReactMouseEvent<HTMLElement>) => {
  event.preventDefault();
  event.stopPropagation();
};

const LocalFileTagTrigger = memo<LocalFileTagTriggerProps>(
  ({ children, className, editor, nodeKey, ref: forwardedRef, title, ...rest }) => {
    const spanRef = useRef<HTMLSpanElement>(null);

    const setSpanRef = useCallback(
      (element: HTMLSpanElement | null) => {
        spanRef.current = element;

        if (!forwardedRef) return;
        if (typeof forwardedRef === 'function') {
          forwardedRef(element);
          return;
        }

        const mutableRef = forwardedRef as { current: HTMLSpanElement | null };
        mutableRef.current = element;
      },
      [forwardedRef],
    );

    const onClick = useCallback(
      (payload: MouseEvent) => {
        if (!editor || !nodeKey) return false;
        if (
          payload.target !== spanRef.current &&
          !spanRef.current?.contains(payload.target as Node)
        ) {
          return false;
        }

        payload.preventDefault();
        editor.update(() => {
          const selection = $createNodeSelection();
          selection.add(nodeKey);
          $setSelection(selection);
        });
        return true;
      },
      [editor, nodeKey],
    );

    useEffect(() => {
      if (!editor || !nodeKey) return;
      return editor.registerCommand(CLICK_COMMAND, onClick, COMMAND_PRIORITY_LOW);
    }, [editor, nodeKey, onClick]);

    return (
      <Tag
        {...rest}
        className={cx(stylex.props(styles.tag).className, className)}
        ref={setSpanRef}
        title={title}
      >
        {children}
      </Tag>
    );
  },
);

LocalFileTagTrigger.displayName = 'LocalFileTagTrigger';

export const LocalFileTag = memo<LocalFileTagProps>(({ className, editor, file, nodeKey }) => {
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  const parsed = useMemo(
    () => parseLocalFileHref(file.path, { workingDirectory }),
    [file.path, workingDirectory],
  );
  const allowExternalFilePreview =
    !!parsed && (!workingDirectory || parsed.workingDirectory !== workingDirectory);
  const canPreview = isDesktop && !file.isDirectory && !!parsed?.workingDirectory;
  const canRenderImagePreview = canPreview && isPreviewableImageFile(file);

  const { data: imagePreview } = useClientDataSWR<LocalFilePreview>(
    canRenderImagePreview && parsed
      ? localFileKeys.preview({
          accept: 'image',
          allowExternalFile: allowExternalFilePreview || undefined,
          filePath: parsed.filePath,
          workingDirectory: parsed.workingDirectory,
        })
      : null,
    () =>
      projectFileService.getLocalFilePreview({
        accept: 'image',
        allowExternalFile: allowExternalFilePreview || undefined,
        path: parsed!.filePath,
        workingDirectory: parsed!.workingDirectory,
      }),
    { revalidateOnFocus: false },
  );
  const [imageSrc, setImageSrc] = useState<string>();

  useEffect(() => {
    if (!canRenderImagePreview || imagePreview?.type !== 'image') {
      setImageSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(imagePreview.blob);
    setImageSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [canRenderImagePreview, imagePreview]);

  const handlePreview = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      stopActionPropagation(event);
      if (!parsed) return;

      openLocalFile({
        allowExternalFilePreview,
        filePath: parsed.filePath,
        workingDirectory: parsed.workingDirectory,
      });
    },
    [allowExternalFilePreview, openLocalFile, parsed],
  );

  const handleOpen = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      stopActionPropagation(event);
      void localFileService.openLocalFileOrFolder(file.path, !!file.isDirectory);
    },
    [file.isDirectory, file.path],
  );

  const handleReveal = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      stopActionPropagation(event);
      void localFileService.openFileFolder(file.path);
    },
    [file.path],
  );

  const content = (
    <Flexbox
      className={stylex.props(styles.popover).className}
      gap={10}
      onClick={(event) => event.stopPropagation()}
    >
      {imageSrc && (
        <div {...stylex.props(styles.previewFrame)}>
          <img
            alt={file.name}
            {...stylex.props(styles.previewImage)}
            data-testid="local-file-image-hover-preview"
            draggable={false}
            src={imageSrc}
          />
        </div>
      )}
      <Text className={stylex.props(styles.path).className}>{file.path}</Text>
      {isDesktop && (
        <Flexbox horizontal className={stylex.props(styles.actionBar).className} gap={6}>
          {canPreview && (
            <Button icon={<Icon icon={EyeIcon} />} size={'small'} onClick={handlePreview}>
              {t('workingPanel.documents.preview')}
            </Button>
          )}
          <Button icon={<Icon icon={ExternalLink} />} size={'small'} onClick={handleOpen}>
            {t('workingPanel.files.open')}
          </Button>
          <Button icon={<Icon icon={FolderOpen} />} size={'small'} onClick={handleReveal}>
            {t('workingPanel.files.showInSystem')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <Popover content={content} styles={{ content: { padding: 8 } }} trigger={'hover'}>
      <LocalFileTagTrigger
        className={className}
        editor={editor}
        nodeKey={nodeKey}
        title={file.path}
      >
        {imageSrc ? (
          <img
            alt=""
            {...stylex.props(styles.thumbnail)}
            data-testid="local-file-image-preview"
            draggable={false}
            src={imageSrc}
          />
        ) : (
          <FileIcon
            fileName={file.name}
            isDirectory={!!file.isDirectory}
            size={16}
            variant={'raw'}
          />
        )}
        <span {...stylex.props(styles.label)}>{file.name}</span>
      </LocalFileTagTrigger>
    </Popover>
  );
});

LocalFileTag.displayName = 'LocalFileTag';
