import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { imageToBase64 } from '@/utils/imageToBase64';

/** Matches the avatar picker's own uploader, so both paths store the same image. */
const AVATAR_SIZE = 256;

/** Center-crop a dropped image to the square the picker would have produced. */
const toAvatarFile = async (file: File) => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const blob = await (await fetch(imageToBase64({ img, size: AVATAR_SIZE }))).blob();
    return new File([blob], 'avatar.webp', { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(url);
  }
};

interface UseProjectAvatarUploadOptions {
  onChange: (avatar: string) => void;
  /** An upload is in flight; the avatar it brings arrives through `onChange` later. */
  onUploadingChange?: (uploading: boolean) => void;
}

/** Upload a project avatar image and report the stored URL once it lands. */
export const useProjectAvatarUpload = ({
  onChange,
  onUploadingChange,
}: UseProjectAvatarUploadOptions) => {
  const { t } = useTranslation('project');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploadingState] = useState(false);
  const setUploading = (next: boolean) => {
    setUploadingState(next);
    onUploadingChange?.(next);
  };

  /** `crop` center-crops a raw image; the picker's uploader has already done it. */
  const upload = async (file: File, { crop }: { crop: boolean }) => {
    setUploading(true);
    try {
      const result = await uploadWithProgress({ file: crop ? await toAvatarFile(file) : file });
      if (!result?.url) throw new Error('Upload returned no URL');
      onChange(result.url);
    } catch (error) {
      console.error('Failed to upload project avatar', error);
      toast.error(t('create.avatarUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
};
