import { Center, FileTypeIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Upload } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { useCreateNewModal } from '@/features/LibraryModal';
import { useFileStore } from '@/store/file';

const ICON_SIZE = 80;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionTitle: css`
    margin-block-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorTextSecondary};
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 200px;
    height: 140px;
    border-radius: ${cssVar.borderRadiusLG};

    font-weight: 500;
    text-align: center;

    background: ${cssVar.colorFillTertiary};
    box-shadow: 0 0 0 1px ${cssVar.colorFillTertiary} inset;

    transition: background 0.3s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  glow: css`
    position: absolute;
    inset-block-end: -12px;
    inset-inline-end: 0;

    width: 48px;
    height: 48px;

    opacity: 0.5;
    filter: blur(24px);
  `,
  icon: css`
    position: absolute;
    z-index: 1;
    inset-block-end: -24px;
    inset-inline-end: 8px;

    flex: none;
  `,
}));

const EmptyPlaceholder = () => {
  const { t } = useTranslation('components');

  const pushDockFileList = useFileStore((s) => s.pushDockFileList);

  const libraryId = useResourceManagerStore((s) => s.libraryId);

  const { open } = useCreateNewModal();

  return (
    <Center gap={24} height={'100%'} style={{ paddingBottom: 100 }} width={'100%'}>
      <Flexbox justify={'center'} style={{ textAlign: 'center' }}>
        <Text as={'h4'}>{t('FileManager.emptyStatus.title')}</Text>
        <Text type={'secondary'}>{t('FileManager.emptyStatus.or')}</Text>
      </Flexbox>
      <Flexbox horizontal gap={12}>
        {!libraryId && (
          <Flexbox
            className={styles.card}
            padding={16}
            onClick={() => {
              open();
            }}
          >
            <span className={styles.actionTitle}>
              {t('FileManager.emptyStatus.actions.knowledgeBase')}
            </span>
            <div className={styles.glow} style={{ background: cssVar.purple }} />
            <FileTypeIcon
              className={styles.icon}
              color={cssVar.purple}
              icon={<Icon color={'#fff'} icon={PlusIcon} />}
              size={ICON_SIZE}
              type={'folder'}
            />
          </Flexbox>
        )}
        <Upload
          multiple={true}
          showUploadList={false}
          beforeUpload={async (file) => {
            await pushDockFileList([file], libraryId);

            return false;
          }}
        >
          <Flexbox className={styles.card} padding={16}>
            <span className={styles.actionTitle}>{t('FileManager.emptyStatus.actions.file')}</span>
            <div className={styles.glow} style={{ background: cssVar.gold }} />
            <FileTypeIcon
              className={styles.icon}
              color={cssVar.gold}
              icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
              size={ICON_SIZE}
            />
          </Flexbox>
        </Upload>
        <Upload
          directory
          multiple={true}
          showUploadList={false}
          beforeUpload={async (file) => {
            await pushDockFileList([file], libraryId);

            return false;
          }}
        >
          <Flexbox className={styles.card} padding={16}>
            <span className={styles.actionTitle}>
              {t('FileManager.emptyStatus.actions.folder')}
            </span>
            <div className={styles.glow} style={{ background: cssVar.geekblue }} />
            <FileTypeIcon
              className={styles.icon}
              color={cssVar.geekblue}
              icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
              size={ICON_SIZE}
              type={'folder'}
            />
          </Flexbox>
        </Upload>
      </Flexbox>
    </Center>
  );
};

export default EmptyPlaceholder;
