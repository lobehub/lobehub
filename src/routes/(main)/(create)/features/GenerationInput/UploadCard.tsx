'use client';

import { ActionIcon, Block, Icon, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LoaderCircle, Plus, X } from 'lucide-react';
import type { ChangeEvent, CSSProperties } from 'react';
import { memo, useCallback, useRef, useState } from 'react';

import Image from '@/libs/next/Image';
import { useFileStore } from '@/store/file';
import { sx } from '@/styles/sx';

import { uploadCardMarker } from './markers.stylex';

export const UPLOAD_CARD_SIZE = 64;
const ADD_CIRCLE_SIZE = 28;

export type UploadData = string | { dimensions?: { height: number; width: number }; url: string };

export const uploadCardStyles = stylex.create({
  addCircle: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${ADD_CIRCLE_SIZE}px`,
    height: `${ADD_CIRCLE_SIZE}px`,
    borderRadius: '50%',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorPrimary },
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorPrimaryBg },
    backgroundImage: 'none',
    boxShadow: {
      'default': `0 2px 8px rgb(0 0 0 / 15%), 0 0 0 1px ${cssVar.colorBorderSecondary}`,
      ':hover': `0 2px 8px rgb(0 0 0 / 15%), 0 0 0 1px ${cssVar.colorPrimary}`,
    },
    transition: `all ${cssVar.motionDurationMid} ease`,
  },
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 4,
    insetBlockEnd: '4px',
    insetInlineStart: '4px',
    paddingBlock: '1px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '10px',
    lineHeight: '14px',
    color: cssVar.colorWhite,
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
  },
  // Visible only while the card (`uploadCardMarker`) is hovered.
  closeButton: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '-6px',
    insetInlineEnd: '-6px',
    borderRadius: '50%',
    opacity: { default: 0, [stylex.when.ancestor(':hover', uploadCardMarker)]: 1 },
  },
  // The inline `zIndex` stacks the cards; hovering lifts one above its siblings.
  filledCard: (zIndex?: CSSProperties['zIndex']) => ({
    cursor: 'pointer',
    position: 'relative',
    zIndex: { 'default': zIndex ?? 'auto', ':hover': 99 },
    flexShrink: 0,
    width: `${UPLOAD_CARD_SIZE}px`,
    height: `${UPLOAD_CARD_SIZE}px`,
    padding: '2px',
    borderRadius: '6px',
    transition: `all ${cssVar.motionDurationMid} ease`,
  }),
  filledCardInner: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    borderRadius: '3px',
  },
  label: {
    paddingInline: '4px',
    fontSize: '10px',
    lineHeight: 1,
    color: cssVar.colorTextQuaternary,
    textAlign: 'center',
  },
  placeholderCard: {
    cursor: 'pointer',
    flexShrink: 0,
    width: `${UPLOAD_CARD_SIZE}px`,
    height: `${UPLOAD_CARD_SIZE}px`,
    borderRadius: '6px',
    color: cssVar.colorTextQuaternary,
  },
  uploadOverlay: {
    position: 'absolute',
    zIndex: 5,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '3px',
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
  },
});

interface UploadCardProps {
  /** Short tag drawn on the filled preview, e.g. "Image 1" for prompt references. */
  badge?: string;
  className?: string;
  imageUrl?: string | null;
  label?: string;
  /** Show an upload spinner overlay (for externally-managed batch uploads). */
  loading?: boolean;
  maxFileSize?: number;
  /** Allow selecting multiple files at once (requires `onUploadFiles`). */
  multiple?: boolean;
  onRemove: () => void;
  onUpload: (data: UploadData) => void;
  /**
   * Batch upload handler. When provided, file selection is delegated to the
   * parent (which uploads + lands all files together) instead of the card's
   * internal single-file upload, enabling multi-select.
   */
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  style?: CSSProperties;
  variant?: 'card' | 'circle';
}

const UploadCard = memo<UploadCardProps>(
  ({
    badge,
    imageUrl,
    label,
    loading = false,
    onUpload,
    onUploadFiles,
    onRemove,
    maxFileSize,
    multiple = false,
    className,
    style,
    variant = 'card',
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadPreview, setUploadPreview] = useState<string | null>(null);

    // Combine internal single-upload spinner with externally-driven batch loading.
    const uploading = isUploading || loading;

    const handleFileSelect = useCallback(() => {
      if (loading) return;
      inputRef.current?.click();
    }, [loading]);

    const handleFileChange = useCallback(
      async (e: ChangeEvent<HTMLInputElement>) => {
        // When a batch handler is provided, delegate all selected files to the
        // parent so multiple references can be uploaded and landed at once.
        if (onUploadFiles) {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          await onUploadFiles(files);
          return;
        }

        const file = e.target.files?.[0];
        if (!file) return;

        if (maxFileSize && file.size > maxFileSize) return;

        const previewUrl = URL.createObjectURL(file);
        setUploadPreview(previewUrl);
        setIsUploading(true);

        try {
          const result = await uploadWithProgress({
            file,
            onStatusUpdate: () => {},
            skipCheckFileType: true,
          });

          if (result?.url) {
            const data = result.dimensions
              ? { dimensions: result.dimensions, url: result.url }
              : result.url;
            onUpload(data);
          }
        } finally {
          URL.revokeObjectURL(previewUrl);
          setUploadPreview(null);
          setIsUploading(false);
        }
      },
      [maxFileSize, uploadWithProgress, onUpload, onUploadFiles],
    );

    const showPreview = uploadPreview || imageUrl;
    const { zIndex, ...restStyle } = style ?? {};

    const fileInput = (
      <input
        accept="image/*"
        multiple={multiple}
        ref={inputRef}
        style={{ display: 'none' }}
        type="file"
        onChange={handleFileChange}
        onClick={(e) => {
          e.currentTarget.value = '';
        }}
      />
    );

    if (variant === 'circle' && !showPreview) {
      return (
        <>
          {fileInput}
          <div {...sx([uploadCardStyles.addCircle], className, style)} onClick={handleFileSelect}>
            <Plus size={14} />
          </div>
        </>
      );
    }

    if (showPreview) {
      return (
        <>
          {fileInput}
          <Block
            clickable
            {...sx([uploadCardMarker, uploadCardStyles.filledCard(zIndex)], className, restStyle)}
            variant={'outlined'}
            onClick={handleFileSelect}
          >
            <div {...stylex.props(uploadCardStyles.filledCardInner)}>
              <Image
                fill
                unoptimized
                alt=""
                src={uploadPreview || imageUrl!}
                style={{ objectFit: 'cover' }}
              />
              {badge && !uploading && (
                <span {...stylex.props(uploadCardStyles.badge)}>{badge}</span>
              )}
              {uploading && (
                <div {...stylex.props(uploadCardStyles.uploadOverlay)}>
                  {/* The mask is a dark scrim in both themes, so the spinner needs a fixed
                      white rather than a theme-following token. */}
                  <Spin
                    size="small"
                    indicator={
                      <Icon
                        spin
                        icon={LoaderCircle}
                        size={14}
                        style={{ color: cssVar.colorWhite }}
                      />
                    }
                  />
                </div>
              )}
            </div>
            {!uploading && (
              <ActionIcon
                glass
                className={stylex.props(uploadCardStyles.closeButton).className}
                icon={X}
                size={12}
                variant="outlined"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              />
            )}
          </Block>
        </>
      );
    }

    return (
      <>
        {fileInput}
        <Block
          clickable
          align={'center'}
          gap={4}
          justify={'center'}
          {...sx([uploadCardStyles.placeholderCard], className, style)}
          variant={'filled'}
          onClick={handleFileSelect}
        >
          <Plus size={20} />
          {label && <span {...stylex.props(uploadCardStyles.label)}>{label}</span>}
        </Block>
      </>
    );
  },
);

UploadCard.displayName = 'UploadCard';

export default UploadCard;
