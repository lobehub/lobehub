import { Icon, Progress } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon, Loader2Icon, RotateCwIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import FileIcon from '@/components/FileIcon';
import { openFilePreviewModal } from '@/features/ChatInput/Desktop/ContextContainer/ContextItem/FilePreviewModal.loader';
import {
  getUploadChipSize,
  getUploadChipState,
} from '@/features/ChatInput/Desktop/ContextContainer/ContextItem/utils';
import { formatSize } from '@/utils/format';

import type { DraftFile } from './useAttachments';

const HOVER = '@media (hover: hover)';
const TILE = 64;

const styles = stylex.create({
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    paddingBlockStart: 10,
    paddingInline: 10,
  },
  tile: {
    position: 'relative',
    flexShrink: 0,
    height: TILE,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  imageTile: { width: TILE },
  fileTile: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    width: 224,
    paddingInline: 10,
  },
  clickable: { cursor: 'pointer' },
  failed: { borderColor: cssVar.colorErrorBorder },
  image: {
    display: 'block',
    width: '100%',
    height: '100%',
    borderRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,
    objectFit: 'cover',
  },
  /** Dims an image while it uploads or after it failed, so the state reads at a glance. */
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,
    color: cssVar.colorTextLightSolid,
    backgroundColor: cssVar.colorBgMask,
  },
  retryOverlay: { cursor: 'pointer' },
  fileText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: '1',
  },
  name: {
    overflow: 'hidden',
    fontSize: cssVar.fontSize,
    lineHeight: 1.4,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    fontSize: cssVar.fontSizeSM,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
  },
  error: { color: cssVar.colorError },
  retry: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 2,
    alignItems: 'center',
    padding: 0,
    borderWidth: 0,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorPrimary,
    backgroundColor: 'transparent',
  },
  /** Corner remove button: always there on touch, revealed by hover or focus with a pointer. */
  remove: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: -6,
    insetInlineEnd: -6,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    color: cssVar.colorBgContainer,
    backgroundColor: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    opacity: {
      default: 1,
      [HOVER]: {
        'default': 0,
        ':focus-visible': 1,
        [stylex.when.ancestor(':hover')]: 1,
        [stylex.when.ancestor(':focus-within')]: 1,
      },
    },
  },
});

/** Opens an uploaded attachment's preview by click, Enter or Space, like a button. */
const previewProps = (item: DraftFile, canPreview: boolean) =>
  canPreview
    ? {
        onClick: () => void openFilePreviewModal(item),
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          void openFilePreviewModal(item);
        },
        role: 'button' as const,
        tabIndex: 0,
      }
    : {};

interface ItemProps {
  item: DraftFile;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const RemoveButton = ({ item, onRemove }: Omit<ItemProps, 'onRetry'>) => {
  const { t } = useTranslation('channel');
  return (
    <button
      aria-label={t('attachments.remove', { name: item.file.name })}
      title={t('attachments.remove', { name: item.file.name })}
      type="button"
      {...stylex.props(styles.remove)}
      onClick={(event) => {
        event.stopPropagation();
        onRemove(item.id);
      }}
    >
      <Icon icon={XIcon} size={11} />
    </button>
  );
};

/** What the tile says about an upload that is not done yet. */
const Progressing = ({ item, light }: { item: DraftFile; light?: boolean }) => {
  const { progress } = getUploadChipState(item);
  return progress === undefined || item.status !== 'uploading' ? (
    <Icon spin icon={Loader2Icon} size={light ? 18 : 12} />
  ) : (
    <Progress
      percent={progress}
      showInfo={false}
      size={light ? 22 : 12}
      status="normal"
      // Drawn in the overlay's light text color, so the ring reads on any image.
      strokeColor={light ? 'currentColor' : undefined}
      type="circle"
    />
  );
};

const ImageTile = ({ item, onRemove, onRetry }: ItemProps) => {
  const { t } = useTranslation('channel');
  const { busy, canPreview, canRetry } = getUploadChipState(item);
  return (
    <div
      aria-busy={busy}
      title={item.file.name}
      {...stylex.props(
        stylex.defaultMarker(),
        styles.tile,
        styles.imageTile,
        canPreview && styles.clickable,
        canRetry && styles.failed,
      )}
      {...previewProps(item, canPreview)}
    >
      <img
        alt={item.file.name}
        src={item.previewUrl ?? item.fileUrl}
        {...stylex.props(styles.image)}
      />
      {busy && (
        <div
          aria-label={t('attachments.uploading')}
          role="status"
          {...stylex.props(styles.overlay)}
        >
          <Progressing light item={item} />
        </div>
      )}
      {canRetry &&
        (item.errorCode ? (
          <div {...stylex.props(styles.overlay)}>
            <FileUploadErrorActions compact code={item.errorCode} />
          </div>
        ) : (
          <button
            aria-label={t('attachments.retry')}
            title={item.error ?? t('attachments.failed')}
            type="button"
            {...stylex.props(styles.overlay, styles.retryOverlay)}
            onClick={(event) => {
              event.stopPropagation();
              onRetry(item.id);
            }}
          >
            <Icon icon={RotateCwIcon} size={18} />
          </button>
        ))}
      <RemoveButton item={item} onRemove={onRemove} />
    </div>
  );
};

const FileTile = ({ item, onRemove, onRetry }: ItemProps) => {
  const { t } = useTranslation('channel');
  const { busy, canPreview, canRetry } = getUploadChipState(item);
  return (
    <div
      aria-busy={busy}
      title={item.file.name}
      {...stylex.props(
        stylex.defaultMarker(),
        styles.tile,
        styles.fileTile,
        canPreview && styles.clickable,
        canRetry && styles.failed,
      )}
      {...previewProps(item, canPreview)}
    >
      <FileIcon fileName={item.file.name} fileType={item.file.type} size={32} />
      <div {...stylex.props(styles.fileText)}>
        <span {...stylex.props(styles.name)}>{item.file.name}</span>
        <span {...stylex.props(styles.meta, canRetry && styles.error)}>
          {busy ? (
            <>
              <Progressing item={item} />
              {getUploadChipSize(item)}
            </>
          ) : canRetry ? (
            <>
              <Icon icon={CircleAlertIcon} size={12} />
              {t('attachments.failedShort')}
              {item.errorCode ? (
                <FileUploadErrorActions compact code={item.errorCode} />
              ) : (
                <button
                  type="button"
                  {...stylex.props(styles.retry)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetry(item.id);
                  }}
                >
                  {t('attachments.retry')}
                </button>
              )}
            </>
          ) : (
            formatSize(item.file.size)
          )}
        </span>
      </div>
      <RemoveButton item={item} onRemove={onRemove} />
    </div>
  );
};

interface ComposerAttachmentsProps {
  disabled?: boolean;
  items: DraftFile[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

/**
 * The composer's pending attachments, IM style: an image is a thumbnail from the moment it is
 * picked, with its upload progress over it; any other file is a compact card. Each removes from
 * its corner and opens a preview once uploaded.
 */
export const ComposerAttachments = ({
  disabled,
  items,
  onRemove,
  onRetry,
}: ComposerAttachmentsProps) => {
  if (!items.length) return null;
  return (
    <div inert={disabled} {...stylex.props(styles.list)}>
      {items.map((item) =>
        item.file.type.startsWith('image/') ? (
          <ImageTile item={item} key={item.id} onRemove={onRemove} onRetry={onRetry} />
        ) : (
          <FileTile item={item} key={item.id} onRemove={onRemove} onRetry={onRetry} />
        ),
      )}
    </div>
  );
};
