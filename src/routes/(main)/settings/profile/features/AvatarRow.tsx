'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Spin, Upload } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { PencilIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import { labelStyle, rowStyle } from './ProfileRow';

const styles = createStaticStyles(({ css }) => ({
  overlay: css`
    cursor: pointer;

    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    opacity: 0;
    background: ${cssVar.colorBgMask};
    border-radius: 8px;

    transition: opacity ${cssVar.motionDurationMid} ease;
  `,
  wrapper: css`
    cursor: pointer;
    position: relative;
    overflow: hidden;
    border-radius: 8px;

    &:hover .avatar-edit-overlay {
      opacity: 1;
    }
  `,
}));

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
    <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
      <Spin indicator={<LoadingOutlined spin />} spinning={uploading}>
        <div className={styles.wrapper}>
          <UserAvatar size={40} />
          <div className={`${styles.overlay} avatar-edit-overlay`}>
            <Icon color={cssVar.colorTextLightSolid} icon={PencilIcon} size={16} />
          </div>
        </div>
      </Spin>
    </Upload>
  ) : (
    <UserAvatar size={40} />
  );

  if (mobile) {
    return (
      <Flexbox horizontal align="center" gap={12} justify="space-between" style={rowStyle}>
        <Text strong>{t('profile.avatar')}</Text>
        {avatarContent}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.avatar')}</Text>
      <Flexbox align="flex-end" style={{ flex: 1 }}>{avatarContent}</Flexbox>
    </Flexbox>
  );
};

export default AvatarRow;
