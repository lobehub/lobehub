'use client';

import { Center, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Image as ImageIcon, X } from 'lucide-react';
import { type FC } from 'react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Image from '@/libs/next/Image';
import { useDragAndDrop } from '@/routes/(main)/(create)/image/features/ConfigPanel/hooks/useDragAndDrop';
import { useUploadFilesValidation } from '@/routes/(main)/(create)/image/features/ConfigPanel/hooks/useUploadFilesValidation';
import { configPanelStyles } from '@/routes/(main)/(create)/image/features/ConfigPanel/style';
import { type ImageConstraints } from '@/routes/(main)/(create)/image/features/ConfigPanel/utils/imageValidation';
import { useFileStore } from '@/store/file';
import { type FileUploadStatus } from '@/types/files/upload';

import { imageUploadMarker } from '../markers.stylex';

// ======== Business Types ======== //

export interface ImageUploadProps {
  // Callback when URL changes - supports both old API (string) and new API (object with dimensions)
  className?: string; // Image URL
  /** Image dimension constraints with optional min/max for width and height */
  imageConstraints?: ImageConstraints;
  maxFileSize?: number;
  onChange?: (
    data?:
      | string // Old API: just URL
      | { dimensions?: { height: number; width: number }; url: string }, // New API: URL with dimensions
  ) => void;
  /** Height of the empty placeholder area. Defaults to 160. */
  placeholderHeight?: number;
  style?: React.CSSProperties;
  value?: string | null;
}

/**
 * Internal type for managing upload state
 */
interface UploadState {
  error?: string; // Upload progress (0-100)
  previewUrl: string;
  progress: number;
  // Local blob URL for preview
  status: FileUploadStatus;
}

// ======== Styles ======== //

const styles = stylex.create({
  changeButton: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimary },
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    fontWeight: 500,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorBgElevated },
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  // Revealed while the success display (`imageUploadMarker`) is hovered.
  changeOverlay: {
    position: 'absolute',
    zIndex: 5,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: { default: 0, [stylex.when.ancestor(':hover', imageUploadMarker)]: 1 },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid} ease`,
  },
  deleteIcon: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    color: { 'default': cssVar.colorTextLightSolid, ':hover': cssVar.colorError },
    opacity: { default: 0, [stylex.when.ancestor(':hover', imageUploadMarker)]: 1 },
    backgroundColor: { 'default': cssVar.colorBgMask, ':hover': cssVar.colorErrorBg },
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid} ease`,
  },
  placeholder: {
    cursor: 'pointer',
    width: '100%',
    height: '160px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
    transition: `all ${cssVar.motionDurationMid} ease`,
  },
  placeholderIcon: { color: cssVar.colorTextTertiary },
  placeholderText: {
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  successDisplay: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '160px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: `all ${cssVar.motionDurationMid} ease`,
  },
  uploadingDisplay: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '160px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorPrimary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  uploadingOverlay: {
    position: 'absolute',
    zIndex: 5,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
  },
});

// ======== Utils ======== //

/**
 * Check if a URL is a local blob URL
 */
const isLocalBlobUrl = (url: string): boolean => url.startsWith('blob:');

// ======== Sub-Components ======== //

/**
 * Circular progress bar component (reused from MultiImagesUpload)
 */
interface CircularProgressProps {
  showText?: boolean; // 0-100
  size?: number;
  strokeWidth?: number;
  value: number;
}

const CircularProgress: FC<CircularProgressProps> = memo(
  ({ value, size = 60, strokeWidth = 6, showText = true }) => {
    // Ensure value is between 0 and 100
    const progress = Math.min(100, Math.max(0, value));

    // Calculate circle properties
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (progress / 100) * circumference;

    return (
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          height: size,
          justifyContent: 'center',
          position: 'relative',
          width: size,
        }}
      >
        {/* Background circle */}
        <svg
          height={size}
          style={{ position: 'absolute', transform: 'rotate(-90deg)' }}
          width={size}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={cssVar.colorBorder}
            strokeWidth={strokeWidth}
          />
        </svg>

        {/* Progress circle */}
        <svg
          height={size}
          style={{ position: 'absolute', transform: 'rotate(-90deg)' }}
          width={size}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={cssVar.colorPrimary}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
            style={{
              transition: 'stroke-dashoffset 0.2s ease-in-out',
            }}
          />
        </svg>

        {/* Progress text */}
        {showText && (
          <span
            style={{
              color: cssVar.colorPrimary,
              fontSize: '12px',
              fontWeight: 600,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {Math.round(progress)}%
          </span>
        )}
      </div>
    );
  },
);

CircularProgress.displayName = 'CircularProgress';

/**
 * Placeholder view component
 */
interface PlaceholderProps {
  height?: number;
  isDragOver?: boolean;
  onClick?: () => void;
}

const Placeholder: FC<PlaceholderProps> = memo(({ isDragOver, onClick, height }) => {
  const configStyles = configPanelStyles;
  const { t } = useTranslation('components');

  return (
    <Center
      className={stylex.props(styles.placeholder, isDragOver && configStyles.dragOver).className}
      gap={16}
      horizontal={false}
      style={height ? { height } : undefined}
      onClick={onClick}
    >
      <ImageIcon
        className={stylex.props(styles.placeholderIcon).className}
        size={48}
        strokeWidth={1.5}
      />
      <div {...stylex.props(styles.placeholderText)}>
        {t('ImageUpload.placeholder.primary')}
        <br />
        {t('ImageUpload.placeholder.secondary')}
      </div>
    </Center>
  );
});

Placeholder.displayName = 'Placeholder';

/**
 * Uploading view component
 */
interface UploadingDisplayProps {
  previewUrl: string;
  progress: number;
}

const UploadingDisplay: FC<UploadingDisplayProps> = memo(({ previewUrl, progress }) => {
  return (
    <div {...stylex.props(styles.uploadingDisplay)}>
      <Image
        fill
        unoptimized
        alt="Uploading preview"
        src={previewUrl}
        style={{ objectFit: 'cover' }}
      />
      <div {...stylex.props(styles.uploadingOverlay)}>
        <CircularProgress value={progress} />
      </div>
    </div>
  );
});

UploadingDisplay.displayName = 'UploadingDisplay';

/**
 * Success view component
 */
interface SuccessDisplayProps {
  imageUrl: string;
  isDragOver?: boolean;
  onChangeImage?: () => void;
  onDelete?: () => void;
}

const SuccessDisplay: FC<SuccessDisplayProps> = memo(
  ({ imageUrl, isDragOver, onDelete, onChangeImage }) => {
    const configStyles = configPanelStyles;
    const { t } = useTranslation('components');

    const handleDelete = (event: React.MouseEvent) => {
      event.stopPropagation();
      onDelete?.();
    };

    const handleChangeImage = (event: React.MouseEvent) => {
      event.stopPropagation();
      onChangeImage?.();
    };

    return (
      <div
        onClick={onChangeImage}
        {...stylex.props(
          imageUploadMarker,
          styles.successDisplay,
          isDragOver && configStyles.dragOver,
        )}
      >
        <Image
          fill
          unoptimized
          alt="Uploaded image"
          src={imageUrl}
          style={{ objectFit: 'cover' }}
        />

        {/* Delete button */}
        <div {...stylex.props(styles.deleteIcon)} onClick={handleDelete}>
          <X size={14} />
        </div>

        {/* Change image overlay */}
        <div {...stylex.props(styles.changeOverlay)} onClick={handleChangeImage}>
          <button {...stylex.props(styles.changeButton)} type="button">
            {t('ImageUpload.actions.changeImage')}
          </button>
        </div>
      </div>
    );
  },
);

SuccessDisplay.displayName = 'SuccessDisplay';

// ======== Main Component ======== //

const ImageUpload: FC<ImageUploadProps> = memo(
  ({ value, onChange, style, className, maxFileSize, imageConstraints, placeholderHeight }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const [uploadState, setUploadState] = useState<UploadState | null>(null);
    const { t } = useTranslation('components');

    const { validateFiles, validateDimensions } = useUploadFilesValidation(
      undefined,
      maxFileSize,
      imageConstraints,
    );

    // Cleanup blob URLs to prevent memory leaks
    useEffect(() => {
      return () => {
        if (uploadState?.previewUrl && isLocalBlobUrl(uploadState.previewUrl)) {
          URL.revokeObjectURL(uploadState.previewUrl);
        }
      };
    }, [uploadState?.previewUrl]);

    const handleFileSelect = () => {
      inputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file using unified validation hook
      if (!validateFiles([file])) return;

      // Validate image dimensions
      if (!(await validateDimensions(file))) return;

      // Create preview URL
      const previewUrl = URL.createObjectURL(file);

      // Set initial upload state
      setUploadState({
        previewUrl,
        progress: 0,
        status: 'pending',
      });

      try {
        // Start upload
        const result = await uploadWithProgress({
          file,
          onStatusUpdate: (updateData) => {
            if (updateData.type === 'updateFile') {
              setUploadState((prev) => {
                if (!prev) return null;

                const fileStatus = updateData.value.status;
                if (!fileStatus) return prev;

                return {
                  ...prev,
                  error: fileStatus === 'error' ? 'Upload failed' : undefined,
                  progress: updateData.value.uploadState?.progress || 0,
                  status: fileStatus,
                };
              });
            } else if (updateData.type === 'removeFile') {
              // Handle file removal
              setUploadState(null);
            }
          },
          skipCheckFileType: true,
        });

        if (result?.url) {
          // Upload successful - pass dimensions if available
          const callbackData = result.dimensions
            ? { dimensions: result.dimensions, url: result.url }
            : result.url;
          onChange?.(callbackData);
        }
      } catch {
        // Upload failed
        setUploadState((prev) =>
          prev
            ? {
                ...prev,
                error: 'Upload failed',
                status: 'error',
              }
            : null,
        );
      } finally {
        // Cleanup
        if (isLocalBlobUrl(previewUrl)) {
          URL.revokeObjectURL(previewUrl);
        }

        // Clear upload state after a delay to show completion
        setTimeout(() => {
          setUploadState(null);
        }, 1000);
      }
    };

    const handleDelete = () => {
      onChange?.(undefined);
    };

    const handleDrop = async (files: File[]) => {
      // Show warning if multiple files detected
      if (files.length > 1) {
        toast.warning(t('ImageUpload.actions.dropMultipleFiles'));
      }

      // Take the first image file
      const file = files[0];

      // Validate file using unified validation hook
      if (!validateFiles([file])) return;

      // Validate image dimensions
      if (!(await validateDimensions(file))) return;

      // Create preview URL
      const previewUrl = URL.createObjectURL(file);

      // Set initial upload state
      setUploadState({
        previewUrl,
        progress: 0,
        status: 'pending',
      });

      try {
        // Start upload using the same logic as handleFileChange
        const result = await uploadWithProgress({
          file,
          onStatusUpdate: (updateData) => {
            if (updateData.type === 'updateFile') {
              setUploadState((prev) => {
                if (!prev) return null;

                const fileStatus = updateData.value.status;
                if (!fileStatus) return prev;

                return {
                  ...prev,
                  error: fileStatus === 'error' ? 'Upload failed' : undefined,
                  progress: updateData.value.uploadState?.progress || 0,
                  status: fileStatus,
                };
              });
            } else if (updateData.type === 'removeFile') {
              setUploadState(null);
            }
          },
          skipCheckFileType: true,
        });

        if (result?.url) {
          // Upload successful - pass dimensions if available
          const callbackData = result.dimensions
            ? { dimensions: result.dimensions, url: result.url }
            : result.url;
          onChange?.(callbackData);
        }
      } catch {
        // Upload failed
        setUploadState((prev) =>
          prev
            ? {
                ...prev,
                error: 'Upload failed',
                status: 'error',
              }
            : null,
        );
      } finally {
        // Cleanup
        if (isLocalBlobUrl(previewUrl)) {
          URL.revokeObjectURL(previewUrl);
        }

        // Clear upload state after a delay to show completion
        setTimeout(() => {
          setUploadState(null);
        }, 1000);
      }
    };

    const { isDragOver, dragHandlers } = useDragAndDrop({
      accept: 'image/*',
      onDrop: handleDrop,
    });

    // Determine which view to render
    const hasImage = Boolean(value);
    const isUploading = Boolean(uploadState);

    return (
      <div className={className} {...dragHandlers} style={style}>
        {/* Hidden file input */}
        <input
          accept="image/*"
          ref={inputRef}
          style={{ display: 'none' }}
          type="file"
          onChange={handleFileChange}
          onClick={(e) => {
            // Reset value to allow re-selecting the same file
            e.currentTarget.value = '';
          }}
        />

        {/* Conditional rendering based on state */}
        {isUploading && uploadState ? (
          <UploadingDisplay previewUrl={uploadState.previewUrl} progress={uploadState.progress} />
        ) : hasImage ? (
          <SuccessDisplay
            imageUrl={value!}
            isDragOver={isDragOver}
            onChangeImage={handleFileSelect}
            onDelete={handleDelete}
          />
        ) : (
          <Placeholder
            height={placeholderHeight}
            isDragOver={isDragOver}
            onClick={handleFileSelect}
          />
        )}
      </div>
    );
  },
);

ImageUpload.displayName = 'ImageUpload';

export default ImageUpload;
