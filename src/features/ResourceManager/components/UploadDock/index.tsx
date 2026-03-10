import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { ActionIcon, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { UploadIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fileManagerSelectors, useFileStore } from '@/store/file';
import { convertAlphaToSolid } from '@/utils/colorUtils';

import Item from './Item';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      position: fixed;
      z-index: 100;
      inset-block-end: 24px;
      inset-inline-end: 24px;

      overflow: hidden;

      width: 360px;
      border: 1px solid ${cssVar.colorSplit};
      border-radius: 8px;

      box-shadow: ${cssVar.boxShadow};
    `,
    progress: css`
      pointer-events: none;

      position: absolute;
      inset-block: 0;
      inset-inline: 0 1%;

      height: 100%;
      border-block-end: 3px solid ${cssVar.geekblue};

      background: ${cssVar.colorFillTertiary};
    `,
    title: css`
      height: 36px;
      font-size: 16px;
      color: ${cssVar.colorText};
    `,
  };
});

/**
 * Show & manage current uploading tasks
 */
const UploadDock = memo(() => {
  const { t } = useTranslation('file');
  const [show, setShow] = useState(true);

  const dispatchDockFileList = useFileStore((s) => s.dispatchDockFileList);
  const expand = useFileStore((s) => s.uploadDockExpanded);
  const setExpand = useFileStore((s) => s.setUploadDockExpanded);
  const totalUploadingProgress = useFileStore(fileManagerSelectors.overviewUploadingProgress);
  const fileList = useFileStore(fileManagerSelectors.dockFileList, isEqual);
  const overviewUploadingStatus = useFileStore(
    fileManagerSelectors.overviewUploadingStatus,
    isEqual,
  );
  const isUploading = overviewUploadingStatus === 'uploading';

  const icon = useMemo(() => {
    switch (overviewUploadingStatus) {
      case 'success': {
        return <CheckCircleFilled style={{ color: cssVar.colorSuccess }} />;
      }
      case 'error': {
        return <CloseCircleFilled style={{ color: cssVar.colorError }} />;
      }

      default: {
        return <Icon icon={UploadIcon} />;
      }
    }
  }, [overviewUploadingStatus]);

  const count = fileList.length;

  useEffect(() => {
    if (show) return;
    if (isUploading) setShow(true);
  }, [isUploading, show]);

  if (count === 0 || !show) return;

  return (
    <Flexbox className={styles.container}>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        style={{
          background: cssVar.colorBgContainer,
          borderBottom: expand ? `1px solid ${cssVar.colorSplit}` : undefined,
          borderBottomLeftRadius: expand ? 0 : 8,
          borderBottomRightRadius: expand ? 0 : 8,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          cursor: 'pointer',
          paddingBlock: 8,
          paddingInline: '24px 12px',
          transition: 'all 0.3s ease-in-out',
        }}
        onClick={() => {
          setExpand(!expand);
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = convertAlphaToSolid(
            cssVar.colorFillTertiary,
            cssVar.colorBgContainer,
          );
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = cssVar.colorBgContainer;
        }}
      >
        <Flexbox horizontal align={'center'} className={styles.title} gap={16}>
          {icon}
          {t(`uploadDock.uploadStatus.${overviewUploadingStatus}`)} ·{' '}
          {t('uploadDock.totalCount', { count })}
        </Flexbox>
        {!isUploading && (
          <ActionIcon
            icon={XIcon}
            onClick={() => {
              setShow(false);
              dispatchDockFileList({ ids: fileList.map((item) => item.id), type: 'removeFiles' });
            }}
          />
        )}
      </Flexbox>

      <AnimatePresence mode="wait">
        {expand ? (
          <motion.div
            animate={{ height: 400, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="expanded"
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <Flexbox
              justify={'space-between'}
              style={{
                background: cssVar.colorBgContainer,
                borderBottomLeftRadius: 8,
                borderBottomRightRadius: 8,
                height: 400,
              }}
            >
              <Flexbox gap={8} paddingBlock={8} style={{ overflowY: 'scroll' }}>
                {fileList.map((item) => (
                  <Item key={item.id} {...item} />
                ))}
              </Flexbox>
              <Center style={{ height: 40, minHeight: 40 }}>
                <Text
                  style={{ cursor: 'pointer' }}
                  type={'secondary'}
                  onClick={() => {
                    setExpand(false);
                  }}
                >
                  {t('uploadDock.body.collapse')}
                </Text>
              </Center>
            </Flexbox>
          </motion.div>
        ) : (
          overviewUploadingStatus !== 'pending' && (
            <motion.div
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0 }}
              initial={{ opacity: 0, scaleY: 0 }}
              key="collapsed"
              style={{ originY: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div
                className={styles.progress}
                style={{
                  borderColor:
                    overviewUploadingStatus === 'success'
                      ? cssVar.colorSuccess
                      : overviewUploadingStatus === 'error'
                        ? cssVar.colorError
                        : undefined,
                  insetInlineEnd: `${100 - totalUploadingProgress}%`,
                }}
              />
            </motion.div>
          )
        )}
      </AnimatePresence>
    </Flexbox>
  );
});

export default UploadDock;
