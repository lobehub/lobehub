import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Popover, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
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
import { TAG_MARGIN_INLINE_END } from '../constants';
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

const styles = createStaticStyles(({ css }) => ({
  actionBar: css`
    flex-wrap: wrap;
    max-width: 320px;
  `,
  label: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  path: css`
    max-width: 360px;
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;

    background: ${cssVar.colorFillQuaternary};
  `,
  popover: css`
    max-width: 392px;
  `,
  previewFrame: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    width: min(360px, 72vw);
    max-height: 240px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  previewImage: css`
    display: block;
    max-width: 100%;
    max-height: 240px;
    object-fit: contain;
  `,
  tag: css`
    cursor: default;
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    max-width: 240px;
    margin-inline-end: ${TAG_MARGIN_INLINE_END}px;
    padding-inline: 2px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorInfo};
    vertical-align: baseline;

    &.selected {
      outline: 2px solid ${cssVar.colorInfo};
      outline-offset: 1px;
    }
  `,
  thumbnail: css`
    flex-shrink: 0;

    width: 16px;
    height: 16px;
    border-radius: ${cssVar.borderRadiusXS};

    object-fit: cover;
    background: ${cssVar.colorFillQuaternary};
    box-shadow: inset 0 0 0 1px ${cssVar.colorFillSecondary};
  `,
}));

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
      <span {...rest} className={cx(styles.tag, className)} ref={setSpanRef} title={title}>
        {children}
      </span>
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
  const canPreview = isDesktop && !file.isDirectory && !!parsed;
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
    <Flexbox className={styles.popover} gap={10} onClick={(event) => event.stopPropagation()}>
      {imageSrc && (
        <div className={styles.previewFrame}>
          <img
            alt={file.name}
            className={styles.previewImage}
            data-testid="local-file-image-hover-preview"
            draggable={false}
            src={imageSrc}
          />
        </div>
      )}
      <Text className={styles.path}>{file.path}</Text>
      {isDesktop && (
        <Flexbox horizontal className={styles.actionBar} gap={6}>
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
            className={styles.thumbnail}
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
        <span className={styles.label}>{file.name}</span>
      </LocalFileTagTrigger>
    </Popover>
  );
});

LocalFileTag.displayName = 'LocalFileTag';
