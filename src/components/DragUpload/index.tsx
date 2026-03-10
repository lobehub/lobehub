 
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileImage, FileText, FileUpIcon } from 'lucide-react';
import { memo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { getContainer, useDragUpload } from './useDragUpload';

const BLOCK_SIZE = 64;
const ICON_SIZE = { size: 36, strokeWidth: 1.5 };

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    container: css`
      width: 320px;
      height: 200px;
      padding: calc(${cssVar.borderRadiusLG} + 4px);
      border-radius: 16px;

      background: ${cssVar.geekblue};
    `,
    content: css`
      width: 100%;
      height: 100%;
      padding: 16px;
      border: 1.5px dashed #fff;
      border-radius: ${cssVar.borderRadiusLG};
    `,
    desc: css`
      font-size: 14px;
      line-height: 22px;
      color: #fff;
    `,
    icon: css`
      border-radius: ${cssVar.borderRadiusLG};
      color: color-mix(in srgb, ${cssVar.geekblue} 95%, black);
      background: color-mix(in srgb, ${cssVar.geekblue} 38%, white);
    `,
    iconGroup: css`
      margin-block-start: -44px;
    `,
    iconLeft: css`
      transform: rotateZ(-20deg) translateX(10px);
      border-radius: ${cssVar.borderRadiusLG};
      color: color-mix(in srgb, ${cssVar.geekblue} 95%, black);
      background: color-mix(in srgb, ${cssVar.geekblue} 68%, white);
    `,
    iconRight: css`
      transform: rotateZ(20deg) translateX(-10px);
      border-radius: ${cssVar.borderRadiusLG};
      color: color-mix(in srgb, ${cssVar.geekblue} 95%, black);
      background: color-mix(in srgb, ${cssVar.geekblue} 68%, white);
    `,
    title: css`
      font-size: 20px;
      font-weight: bold;
      color: #fff;
    `,
    wrapper: css`
      position: fixed;
      z-index: 9999;
      inset: 0;

      width: 100%;
      height: 100%;

      background: ${cssVar.colorBgMask};

      transition: all 0.3s ease-in-out;
    `,
  };
});

interface DragUploadProps {
  enabledFiles?: boolean;
  onUploadFiles: (files: File[]) => Promise<void>;
}

const DragUpload = memo<DragUploadProps>(({ enabledFiles = true, onUploadFiles }) => {
  const { t } = useTranslation('components');

  const isDragging = useDragUpload(onUploadFiles);

  if (isDragging) return;

  return createPortal(
    <Center className={styles.wrapper}>
      <div className={styles.container}>
        <Center className={styles.content} gap={12}>
          <Flexbox horizontal className={styles.iconGroup}>
            <Center className={styles.iconLeft} height={BLOCK_SIZE * 1.25} width={BLOCK_SIZE}>
              <Icon icon={FileImage} size={ICON_SIZE} />
            </Center>
            <Center
              className={styles.icon}
              height={BLOCK_SIZE * 1.25}
              width={BLOCK_SIZE}
              style={{
                transform: 'translateY(-12px)',
                zIndex: 1,
              }}
            >
              <Icon icon={FileUpIcon} size={ICON_SIZE} />
            </Center>
            <Center className={styles.iconRight} height={BLOCK_SIZE * 1.25} width={BLOCK_SIZE}>
              <Icon icon={FileText} size={ICON_SIZE} />
            </Center>
          </Flexbox>
          <Flexbox align={'center'} gap={8} style={{ textAlign: 'center' }}>
            <Flexbox className={styles.title}>
              {t(enabledFiles ? 'DragUpload.dragFileTitle' : 'DragUpload.dragTitle')}
            </Flexbox>
            <Flexbox className={styles.desc}>
              {t(enabledFiles ? 'DragUpload.dragFileDesc' : 'DragUpload.dragDesc')}
            </Flexbox>
          </Flexbox>
        </Center>
      </div>
    </Center>,
    getContainer()!,
  );
});

export default DragUpload;
