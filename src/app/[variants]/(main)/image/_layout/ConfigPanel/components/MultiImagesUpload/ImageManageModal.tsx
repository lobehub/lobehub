'use client';

import { Button, Modal } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Upload, X } from 'lucide-react';
import { type FC } from 'react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUploadFilesValidation } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/hooks/useUploadFilesValidation';
import Image from '@/libs/next/Image';

// ======== Types ======== //

/**
 * Unified image item data structure
 * - url: Remote URL of existing image
 * - file: Newly selected file that needs to be uploaded
 * - previewUrl: Preview URL for local file (blob URL)
 * Items with url are existing images, items with file are files to be uploaded
 */
export interface ImageItem {
  // URL of existing image
  file?: File;
  id: string;
  // Newly selected file
  previewUrl?: string;
  url?: string; // Preview URL for local file, only used when file exists
}

interface ImageManageModalProps {
  images: string[];
  maxCount?: number;
  // Array of existing image URLs
  onClose: () => void;
  onComplete: (imageItems: ImageItem[]) => void;
  open: boolean; // Unified completion callback
}

// ======== Utils ======== //

const getFileName = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    return pathname.split('/').pop() || 'image.jpg';
  } catch {
    return 'image.jpg';
  }
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// ======== Styles ======== //

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    display: flex;
    height: 480px;
    background: ${cssVar.colorBgContainer};
  `,
  fileName: css`
    margin-block-start: 16px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 16px;
    padding-inline: 24px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  modal: css`
    .${prefixCls}-modal-container {
      overflow: hidden;
      padding: 0;
    }
  `,
  newFileIndicator: css`
    position: absolute;
    z-index: 5;
    inset-block-start: 4px;
    inset-inline-start: 4px;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 10px;
    font-weight: 500;
    color: ${cssVar.colorWhite};

    background: ${cssVar.colorSuccess};
  `,
  previewArea: css`
    position: relative;

    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    padding: 24px;
  `,
  previewEmpty: css`
    font-size: 16px;
    color: ${cssVar.colorTextSecondary};
  `,
  previewImage: css`
    max-width: 100%;
    max-height: 320px;
    border-radius: ${cssVar.borderRadiusLG};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  sidebar: css`
    overflow-y: auto;

    width: 200px;
    padding: 16px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgLayout};
  `,
  thumbnail: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 100%;
    height: 120px;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadius};

    transition: border-color 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }

    &:hover .thumbnail-delete {
      opacity: 1;
    }

    &.selected {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  thumbnailDelete: css`
    cursor: pointer;

    position: absolute;
    z-index: 10;
    inset-block-start: 4px;
    inset-inline-end: 4px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 50%;

    color: ${cssVar.colorTextLightSolid};

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity 0.2s ease;

    &:hover {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }
  `,
  thumbnailList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
}));

// ======== Main Component ======== //

const ImageManageModal: FC<ImageManageModalProps> = memo(
  ({ open, images, maxCount, onClose, onComplete }) => {
    const { t } = useTranslation('components');
    const inputRef = useRef<HTMLInputElement>(null);
    const { validateFiles } = useUploadFilesValidation(maxCount);

    // Use unified data structure to manage all images
    const [imageItems, setImageItems] = useState<ImageItem[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);

    // Initialize state when modal opens
    useEffect(() => {
      if (open) {
        // Convert existing URLs to ImageItem format
        const initialItems: ImageItem[] = images.map((url) => ({
          id: generateId(),
          url,
        }));
        setImageItems(initialItems);
        setSelectedIndex(0);
      }
    }, [open, images]);

    // Cleanup blob URLs to prevent memory leaks
    useEffect(() => {
      return () => {
        // Cleanup function: revoke all blob URLs when component unmounts or imageItems change
        imageItems.forEach((item) => {
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        });
      };
    }, [imageItems]);

    // Additional cleanup when modal closes
    useEffect(() => {
      if (!open) {
        imageItems.forEach((item) => {
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        });
        setImageItems([]); // Clear items when modal closes
      }
    }, [open]);

    const selectedItem = imageItems[selectedIndex];

    const handleDelete = (index: number) => {
      const itemToDelete = imageItems[index];

      // Clean up blob URL for the deleted item
      if (itemToDelete?.previewUrl) {
        URL.revokeObjectURL(itemToDelete.previewUrl);
      }

      const newItems = imageItems.filter((_, i) => i !== index);
      setImageItems(newItems);

      // Adjust selected index
      if (selectedIndex >= newItems.length) {
        setSelectedIndex(Math.max(0, newItems.length - 1));
      }
    };

    const handleThumbnailDelete = (index: number, event: React.MouseEvent) => {
      event.stopPropagation();
      handleDelete(index);
    };

    const handleUpload = () => {
      inputRef.current?.click();
    };

    const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      // Validate files, pass current image count
      if (!validateFiles(Array.from(files), imageItems.length)) {
        return;
      }

      // Create new ImageItem, generate one-time preview URL for each file
      const newItems: ImageItem[] = Array.from(files).map((file) => ({
        file,
        id: generateId(),
        previewUrl: URL.createObjectURL(file), // Create only once
      }));

      setImageItems((prev) => [...prev, ...newItems]);
    };

    const handleComplete = () => {
      // Directly pass current complete state to parent component
      onComplete(imageItems);
      onClose();
    };

    const getDisplayUrl = (item: ImageItem): string => {
      if (item.url) {
        return item.url;
      } else if (item.previewUrl) {
        return item.previewUrl;
      }
      return '';
    };

    const getDisplayFileName = (item: ImageItem): string => {
      if (item.file) {
        return item.file.name;
      } else if (item.url) {
        return getFileName(item.url);
      }
      return '';
    };

    const renderThumbnail = (item: ImageItem, index: number) => {
      const displayUrl = getDisplayUrl(item);
      const isNewFile = Boolean(item.file);

      return (
        <div
          className={cx(styles.thumbnail, index === selectedIndex && 'selected')}
          key={item.id}
          onClick={() => setSelectedIndex(index)}
        >
          <Image
            fill
            unoptimized
            alt={`Image ${index + 1}`}
            src={displayUrl}
            style={{ objectFit: 'cover' }}
          />

          {/* 新文件标识 */}
          {isNewFile && (
            <div className={styles.newFileIndicator}>
              {t('MultiImagesUpload.modal.newFileIndicator')}
            </div>
          )}

          {/* 删除按钮 */}
          <div
            className={cx(styles.thumbnailDelete, 'thumbnail-delete')}
            onClick={(e) => handleThumbnailDelete(index, e)}
          >
            <X size={12} />
          </div>
        </div>
      );
    };

    return (
      <Modal
        centered
        className={styles.modal}
        footer={null}
        open={open}
        title={t('MultiImagesUpload.modal.title', { count: imageItems.length })}
        width={720}
        onCancel={onClose}
      >
        {/* Hidden file input */}
        <input
          multiple
          accept="image/*"
          ref={inputRef}
          style={{ display: 'none' }}
          type="file"
          onChange={handleFilesChange}
          onClick={(e) => {
            e.currentTarget.value = '';
          }}
        />

        {/* Content */}
        <div className={styles.content}>
          {/* Sidebar - Thumbnail List */}
          <div className={styles.sidebar}>
            <div className={styles.thumbnailList}>{imageItems.map(renderThumbnail)}</div>
          </div>

          {/* Preview Area */}
          <div className={styles.previewArea}>
            {selectedItem ? (
              <>
                <Image
                  unoptimized
                  alt="Preview"
                  className={styles.previewImage}
                  height={320}
                  src={getDisplayUrl(selectedItem)}
                  style={{ objectFit: 'contain' }}
                  width={400}
                />
                <div className={styles.fileName}>{getDisplayFileName(selectedItem)}</div>
              </>
            ) : (
              <div className={styles.previewEmpty}>
                {t('MultiImagesUpload.modal.selectImageToPreview')}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <Button
            disabled={maxCount ? imageItems.length >= maxCount : false}
            icon={<Upload size={16} />}
            type="default"
            onClick={handleUpload}
          >
            {t('MultiImagesUpload.modal.upload')}
          </Button>

          <Button type="primary" onClick={handleComplete}>
            {t('MultiImagesUpload.modal.complete')}
          </Button>
        </div>
      </Modal>
    );
  },
);

ImageManageModal.displayName = 'ImageManageModal';

export default ImageManageModal;
