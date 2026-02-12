'use client';

import { Center } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Image as ImageIcon, X } from 'lucide-react';
import { type FC } from 'react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDragAndDrop } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/hooks/useDragAndDrop';
import { useUploadFilesValidation } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/hooks/useUploadFilesValidation';
import { configPanelStyles } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/style';
import Image from '@/libs/next/Image';
import { useFileStore } from '@/store/file';
import { type FileUploadStatus } from '@/types/files/upload';

// ======== Business Types ======== //

export interface ImageUploadProps {
  // Callback when URL changes - supports both old API (string) and new API (object with dimensions)
  className?: string; // Image URL
  maxFileSize?: number;
  onChange?: (
    data?:
      | string // Old API: just URL
      | { dimensions?: { height: number; width: number }; url: string }, // New API: URL with dimensions
  ) => void;
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

const styles = createStaticStyles(({ css }) => {
  return {
    changeButton: css`
      cursor: pointer;

      padding-block: 8px;
      padding-inline: 16px;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadius};

      font-size: 12px;
      font-weight: 500;
      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
      box-shadow: ${cssVar.boxShadowSecondary};

      &:hover {
        border-color: ${cssVar.colorPrimary};
        color: ${cssVar.colorPrimary};
        background: ${cssVar.colorBgElevated};
      }
    `,
    changeOverlay: css`
      position: absolute;
      z-index: 5;
      inset: 0;

      display: flex;
      align-items: center;
      justify-content: center;

      opacity: 0;
      background: ${cssVar.colorBgMask};

      transition: opacity ${cssVar.motionDurationMid} ease;
    `,
    container: css`
      width: 100%;
    `,
    deleteIcon: css`
      cursor: pointer;

      position: absolute;
      z-index: 10;
      inset-block-start: 8px;
      inset-inline-end: 8px;

      display: flex;
      align-items: center;
      justify-content: center;

      width: 24px;
      height: 24px;
      border-radius: 50%;

      color: ${cssVar.colorTextLightSolid};

      opacity: 0;
      background: ${cssVar.colorBgMask};

      transition: opacity ${cssVar.motionDurationMid} ease;

      &:hover {
        color: ${cssVar.colorError};
        background: ${cssVar.colorErrorBg};
      }
    `,
    placeholder: css`
      cursor: pointer;

      width: 100%;
      height: 160px;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorFillTertiary};

      transition: all ${cssVar.motionDurationMid} ease;

      &:hover {
        background: ${cssVar.colorFillSecondary};
      }

      &.drag-over {
        transform: scale(1.02);
        border-color: ${cssVar.colorPrimary};
        background: ${cssVar.colorPrimaryBg};
      }
    `,
    placeholderIcon: css`
      color: ${cssVar.colorTextTertiary};
    `,
    placeholderText: css`
      font-size: 12px;
      line-height: 1.4;
      color: ${cssVar.colorTextSecondary};
      text-align: center;
    `,
    successDisplay: css`
      cursor: pointer;

      position: relative;

      overflow: hidden;

      width: 100%;
      height: 160px;
      border: 2px solid transparent;
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgContainer};

      transition: all ${cssVar.motionDurationMid} ease;

      &:hover .change-overlay {
        opacity: 1;
      }

      &:hover .delete-icon {
        opacity: 1;
      }

      &.drag-over {
        transform: scale(1.02);
        border-color: ${cssVar.colorPrimary};
        background: ${cssVar.colorPrimaryBg};
      }
    `,
    uploadingDisplay: css`
      position: relative;

      overflow: hidden;

      width: 100%;
      height: 160px;
      border: 2px solid ${cssVar.colorPrimary};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorFillSecondary};
    `,
    uploadingOverlay: css`
      position: absolute;
      z-index: 5;
      inset: 0;

      display: flex;
      align-items: center;
      justify-content: center;

      background: ${cssVar.colorBgMask};
    `,
  };
});

// ======== Utils ======== //

/**
 * Check if a URL is a local blob URL
 */
const isLocalBlobUrl = (url: string): boolean => url.startsWith('blob:');

// ======== Sub-Components ======== //

/**
 * 圆形进度条组件 (复用自 MultiImagesUpload)
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
 * 占位视图组件
 */
interface PlaceholderProps {
  isDragOver?: boolean;
  onClick?: () => void;
}

const Placeholder: FC<PlaceholderProps> = memo(({ isDragOver, onClick }) => {
  const configStyles = configPanelStyles;
  const { t } = useTranslation('components');

  return (
    <Center
      gap={16}
      horizontal={false}
      className={cx(
        styles.placeholder,
        configStyles.dragTransition,
        isDragOver && configStyles.dragOver,
      )}
      onClick={onClick}
    >
      <ImageIcon className={styles.placeholderIcon} size={48} strokeWidth={1.5} />
      <div className={styles.placeholderText}>
        {t('ImageUpload.placeholder.primary')}
        <br />
        {t('ImageUpload.placeholder.secondary')}
      </div>
    </Center>
  );
});

Placeholder.displayName = 'Placeholder';

/**
 * 上传中视图组件
 */
interface UploadingDisplayProps {
  previewUrl: string;
  progress: number;
}

const UploadingDisplay: FC<UploadingDisplayProps> = memo(({ previewUrl, progress }) => {
  return (
    <div className={styles.uploadingDisplay}>
      <Image
        fill
        unoptimized
        alt="Uploading preview"
        src={previewUrl}
        style={{ objectFit: 'cover' }}
      />
      <div className={styles.uploadingOverlay}>
        <CircularProgress value={progress} />
      </div>
    </div>
  );
});

UploadingDisplay.displayName = 'UploadingDisplay';

/**
 * 成功视图组件
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
        className={cx(
          styles.successDisplay,
          configStyles.dragTransition,
          isDragOver && configStyles.dragOver,
        )}
        onClick={onChangeImage}
      >
        <Image
          fill
          unoptimized
          alt="Uploaded image"
          src={imageUrl}
          style={{ objectFit: 'cover' }}
        />

        {/* Delete button */}
        <div className={cx(styles.deleteIcon, 'delete-icon')} onClick={handleDelete}>
          <X size={14} />
        </div>

        {/* Change image overlay */}
        <div className={cx(styles.changeOverlay, 'change-overlay')} onClick={handleChangeImage}>
          <button className={styles.changeButton} type="button">
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
  ({ value, onChange, style, className, maxFileSize }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const [uploadState, setUploadState] = useState<UploadState | null>(null);
    const { t } = useTranslation('components');
    const { message } = App.useApp();
    const { validateFiles } = useUploadFilesValidation(undefined, maxFileSize);

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
        message.warning(t('ImageUpload.actions.dropMultipleFiles'));
      }

      // Take the first image file
      const file = files[0];

      // Validate file using unified validation hook
      if (!validateFiles([file])) return;

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
          <Placeholder isDragOver={isDragOver} onClick={handleFileSelect} />
        )}
      </div>
    );
  },
);

ImageUpload.displayName = 'ImageUpload';

export default ImageUpload;
