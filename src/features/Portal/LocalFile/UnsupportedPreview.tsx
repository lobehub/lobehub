import { Button, Center, createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    width: 64px;
    height: 64px;
    border-radius: 14px;
    background: ${cssVar.colorFillTertiary};
  `,
}));

interface UnsupportedPreviewProps {
  filePath: string;
  /** Only a file on this desktop can be handed to the system default app. */
  isLocalFile: boolean;
  oversized?: boolean;
}

const UnsupportedPreview = memo<UnsupportedPreviewProps>(({ filePath, isLocalFile, oversized }) => {
  const { t } = useTranslation('chat');
  const filename = filePath.split(/[/\\]/).at(-1) ?? filePath;

  return (
    <Center gap={16} height={'100%'} width={'100%'}>
      <Center className={styles.icon}>
        <FileIcon fileName={filename} size={40} />
      </Center>
      <Flexbox align={'center'} gap={4}>
        <Text style={{ fontWeight: 500 }}>{filename}</Text>
        <Text type={'secondary'}>
          {t(oversized ? 'workingPanel.localFile.tooLarge' : 'workingPanel.localFile.binary')}
        </Text>
      </Flexbox>
      {isLocalFile && (
        <Button onClick={() => localFileService.openLocalFile({ path: filePath })}>
          {t('workingPanel.localFile.document.openWithDefaultApp')}
        </Button>
      )}
    </Center>
  );
});

UnsupportedPreview.displayName = 'UnsupportedPreview';

export default UnsupportedPreview;
