'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Spin, Upload } from 'antd';
import React, { memo, useCallback } from 'react';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { useUserStore } from '@/store/user';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import { type UserAvatarProps } from '../User/UserAvatar';
import UserAvatar from '../User/UserAvatar';

interface AvatarWithUploadProps extends UserAvatarProps {
  compressSize?: number;
}

const AvatarWithUpload = memo<AvatarWithUploadProps>(
  ({ size = 40, compressSize = 256, ...rest }) => {
    const updateAvatar = useUserStore((state) => state.updateAvatar);
    const [uploading, setUploading] = React.useState<boolean>(false);

    const handleUploadAvatar = useCallback(
      createUploadImageHandler(async (avatar) => {
        try {
          setUploading(true);
          // 准备图像
          const img = new Image();
          img.src = avatar;

          // 使用 Promise 等待图片加载
          await new Promise((resolve, reject) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', reject);
          });

          // 压缩图像
          const webpBase64 = imageToBase64({ img, size: compressSize });

          // 上传头像
          await updateAvatar(webpBase64);

          setUploading(false);
        } catch (error) {
          console.error('Failed to upload avatar:', error);
          setUploading(false);

          fetchErrorNotification.error({
            errorMessage: error instanceof Error ? error.message : String(error),
            status: 500,
          });
        }
      }),
      [compressSize, updateAvatar],
    );

    return (
      <Spin indicator={<LoadingOutlined spin />} spinning={uploading}>
        <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
          <UserAvatar clickable size={size} {...(rest as any)} />
        </Upload>
      </Spin>
    );
  },
);

export default AvatarWithUpload;
