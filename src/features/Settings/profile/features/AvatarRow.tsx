'use client';

import { cssVar, Icon, Upload } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Loader2Icon, PencilIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { saveToast } from '@/store/utils/saveToast';
import { sx } from '@/styles/sx';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import ProfileRow from './ProfileRow';

const styles = stylex.create({
  overlay: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: sxVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity ${sxVar.motionDurationMid} ease`,
  },
  wrapper: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '8px',
  },
});

const AvatarRow = () => {
  const { t } = useTranslation('auth');
  const isLogin = useUserStore(authSelectors.isLogin);
  const updateAvatar = useUserStore((s) => s.updateAvatar);
  const [uploading, setUploading] = useState(false);

  const saveAvatar = useCallback(
    async (avatar: string) => {
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
      } catch (error) {
        console.error('Failed to upload avatar:', error);
        saveToast(error, {
          retry: () => void saveAvatar(avatar),
          title: t('profile.avatarUploadError'),
        });
      } finally {
        setUploading(false);
      }
    },
    [updateAvatar, t],
  );

  const handleUploadAvatar = useMemo(() => createUploadImageHandler(saveAvatar), [saveAvatar]);

  const canUpload = isLogin;

  const avatarContent = canUpload ? (
    <Upload maxCount={1} onFiles={([file]) => handleUploadAvatar(file)}>
      <div {...stylex.props(styles.wrapper, stylex.defaultMarker())}>
        <UserAvatar size={40} />
        <div {...sx(styles.overlay, uploading && { opacity: 1 })}>
          <Icon
            color={cssVar.colorTextLightSolid}
            icon={uploading ? Loader2Icon : PencilIcon}
            size={16}
            spin={uploading}
          />
        </div>
      </div>
    </Upload>
  ) : (
    <UserAvatar size={40} />
  );

  return (
    <ProfileRow action={avatarContent} anchor={'profile-avatar'} label={t('profile.avatar')} />
  );
};

export default AvatarRow;
