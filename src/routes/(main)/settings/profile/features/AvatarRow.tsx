'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Flexbox, Text } from '@lobehub/ui';
import { Spin, Upload } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import { labelStyle, rowStyle } from './ProfileRow';

interface AvatarRowProps {
  mobile?: boolean;
}

const AvatarRow = ({ mobile }: AvatarRowProps) => {
  const { t } = useTranslation('auth');
  const isLogin = useUserStore(authSelectors.isLogin);
  const updateAvatar = useUserStore((s) => s.updateAvatar);
  const [uploading, setUploading] = useState(false);

  const handleUploadAvatar = useCallback(
    createUploadImageHandler(async (avatar) => {
      try {
        setUploading(true);
        const img = new Image();
        img.src = avatar;

        await new Promise((resolve, reject) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', reject);
        });

        const webpBase64 = imageToBase64({ img, size: 256 });
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
    [updateAvatar],
  );

  const canUpload = isLogin;

  const avatarContent = canUpload ? (
    <Spin indicator={<LoadingOutlined spin />} spinning={uploading}>
      <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
        <UserAvatar clickable size={40} />
      </Upload>
    </Spin>
  ) : (
    <UserAvatar size={40} />
  );

  const updateAction = canUpload ? (
    <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
      <Text fontSize={13} style={{ cursor: 'pointer' }}>
        {t('profile.updateAvatar')}
      </Text>
    </Upload>
  ) : null;

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong>{t('profile.avatar')}</Text>
          {updateAction}
        </Flexbox>
        <Flexbox>{avatarContent}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} justify="space-between" style={rowStyle}>
      <Flexbox horizontal align="center" gap={24} style={{ flex: 1 }}>
        <Text style={labelStyle}>{t('profile.avatar')}</Text>
        <Flexbox style={{ flex: 1 }}>{avatarContent}</Flexbox>
      </Flexbox>
      {updateAction}
    </Flexbox>
  );
};

export default AvatarRow;
