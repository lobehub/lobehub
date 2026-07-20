'use client';

import { Icon } from '@lobehub/ui';
import { Spin, Upload } from 'antd';
import { LoaderCircleIcon, UploadIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import { CHIEF_AGENT_AVATAR_PRESETS } from './avatars';
import { styles } from './style';

const AVATAR_COMPRESS_SIZE = 256;

interface AvatarGridProps {
  onChange: (avatar: string) => void;
  value: string;
}

const AvatarGrid = memo<AvatarGridProps>(({ onChange, value }) => {
  const { t } = useTranslation('onboarding');
  const [uploading, setUploading] = useState(false);

  const handleUpload = useMemo(
    () =>
      createUploadImageHandler(async (dataUrl) => {
        setUploading(true);
        try {
          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve, reject) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', reject);
          });
          onChange(imageToBase64({ img, size: AVATAR_COMPRESS_SIZE }));
        } finally {
          setUploading(false);
        }
      }),
    [onChange],
  );

  return (
    <div className={styles.presetsGrid}>
      <Upload
        accept={'image/*'}
        beforeUpload={handleUpload}
        itemRender={() => null}
        maxCount={1}
        showUploadList={false}
      >
        <Spin indicator={<Icon spin icon={LoaderCircleIcon} />} spinning={uploading}>
          <div
            aria-label={t('flow.steps.chiefAgent.avatarUpload')}
            className={`${styles.presetTile} ${styles.presetTileUpload}`}
            role={'button'}
          >
            <Icon icon={UploadIcon} size={18} />
          </div>
        </Spin>
      </Upload>
      {CHIEF_AGENT_AVATAR_PRESETS.map((preset) => (
        <div
          aria-label={preset.id}
          aria-pressed={value === preset.avatar}
          className={`${styles.presetTile} ${value === preset.avatar ? styles.presetTileSelected : ''}`}
          key={preset.id}
          role={'button'}
          style={{ background: `${preset.tint}30` }}
          onClick={() => onChange(preset.avatar)}
        >
          <img alt={preset.id} className={styles.presetImage} loading={'lazy'} src={preset.hero} />
        </div>
      ))}
    </div>
  );
});

AvatarGrid.displayName = 'AvatarGrid';

export default AvatarGrid;
