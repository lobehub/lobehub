'use client';

import { Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Plus, X } from 'lucide-react';
import type { ChangeEvent, CSSProperties } from 'react';
import { memo, useCallback, useRef, useState } from 'react';

import Image from '@/libs/next/Image';
import { useFileStore } from '@/store/file';

export const UPLOAD_CARD_SIZE = 64;
const ADD_CIRCLE_SIZE = 28;

export type UploadData = string | { dimensions?: { height: number; width: number }; url: string };

export const uploadCardStyles = createStaticStyles(({ css }) => ({
  addCircle: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: ${ADD_CIRCLE_SIZE}px;
    height: ${ADD_CIRCLE_SIZE}px;
    border-radius: 50%;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 2px 8px rgb(0 0 0 / 15%),
      0 0 0 1px ${cssVar.colorBorderSecondary};

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBg};
      box-shadow:
        0 2px 8px rgb(0 0 0 / 15%),
        0 0 0 1px ${cssVar.colorPrimary};
    }
  `,
  closeButton: css`
    cursor: pointer;

    position: absolute;
    z-index: 10;
    inset-block-start: -6px;
    inset-inline-end: -6px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 50%;

    color: ${cssVar.colorTextLightSolid};

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity ${cssVar.motionDurationMid} ease;

    &:hover {
      background: ${cssVar.colorError};
    }
  `,
  filledCard: css`
    cursor: pointer;

    position: relative;

    flex-shrink: 0;

    width: ${UPLOAD_CARD_SIZE}px;
    height: ${UPLOAD_CARD_SIZE}px;
    border: 3px solid ${cssVar.colorBgElevated};
    border-radius: 6px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 2px 8px rgb(0 0 0 / 15%);

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      z-index: 99 !important;
    }

    &:hover .upload-card-close {
      opacity: 1;
    }
  `,
  filledCardInner: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: 3px;
  `,
  label: css`
    font-size: 10px;
    line-height: 1;
    color: ${cssVar.colorTextQuaternary};
  `,
  placeholderCard: css`
    cursor: pointer;

    flex-shrink: 0;

    width: ${UPLOAD_CARD_SIZE}px;
    height: ${UPLOAD_CARD_SIZE}px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillQuaternary};
    box-shadow: 0 2px 8px rgb(0 0 0 / 10%);

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  uploadOverlay: css`
    position: absolute;
    z-index: 5;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: 3px;

    background: ${cssVar.colorBgMask};
  `,
}));

interface UploadCardProps {
  className?: string;
  closeClassName?: string;
  imageUrl?: string | null;
  label?: string;
  maxFileSize?: number;
  onRemove: () => void;
  onUpload: (data: UploadData) => void;
  style?: CSSProperties;
  variant?: 'card' | 'circle';
}

const UploadCard = memo<UploadCardProps>(
  ({
    imageUrl,
    label,
    onUpload,
    onRemove,
    maxFileSize,
    className,
    closeClassName,
    style,
    variant = 'card',
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadPreview, setUploadPreview] = useState<string | null>(null);

    const handleFileSelect = useCallback(() => {
      inputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      async (e: ChangeEvent<HTMLInputElement>) => {
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
      [maxFileSize, uploadWithProgress, onUpload],
    );

    const showPreview = uploadPreview || imageUrl;

    const fileInput = (
      <input
        accept="image/*"
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
          <div
            className={`${uploadCardStyles.addCircle} ${className || ''}`}
            style={style}
            onClick={handleFileSelect}
          >
            <Plus size={14} />
          </div>
        </>
      );
    }

    if (showPreview) {
      return (
        <>
          {fileInput}
          <div
            className={`${uploadCardStyles.filledCard} ${className || ''}`}
            style={style}
            onClick={handleFileSelect}
          >
            <div className={uploadCardStyles.filledCardInner}>
              <Image
                fill
                unoptimized
                alt=""
                src={uploadPreview || imageUrl!}
                style={{ objectFit: 'cover' }}
              />
              {isUploading && (
                <div className={uploadCardStyles.uploadOverlay}>
                  <Spin size="small" />
                </div>
              )}
            </div>
            {!isUploading && (
              <div
                className={`${uploadCardStyles.closeButton} ${closeClassName || ''} upload-card-close`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <X size={12} />
              </div>
            )}
          </div>
        </>
      );
    }

    return (
      <>
        {fileInput}
        <Flexbox
          align={'center'}
          className={`${uploadCardStyles.placeholderCard} ${className || ''}`}
          justify={'center'}
          style={style}
          onClick={handleFileSelect}
        >
          <Plus size={20} />
          {label && <span className={uploadCardStyles.label}>{label}</span>}
        </Flexbox>
      </>
    );
  },
);

UploadCard.displayName = 'UploadCard';

export default UploadCard;
