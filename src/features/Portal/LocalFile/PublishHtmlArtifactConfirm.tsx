import { Flexbox, Text } from '@lobehub/ui';
import { Button, ScrollArea, useModalContext } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

const CONFIRM_BODY_MAX_HEIGHT = 'min(52vh, 360px)';

const PathList = ({ items }: { items: string[] }) => (
  <Flexbox gap={4}>
    {items.map((item) => (
      <Text key={item} style={{ wordBreak: 'break-all' }} type={'secondary'}>
        {item}
      </Text>
    ))}
  </Flexbox>
);

interface PublishHtmlArtifactConfirmContentProps {
  inlinedPaths: string[];
  inlineLimit: string;
  missing: string[];
  oversized: string[];
  remotes: string[];
  uploadedPaths: string[];
}

export const PublishHtmlArtifactConfirmContent = ({
  inlineLimit,
  inlinedPaths,
  missing,
  oversized,
  remotes,
  uploadedPaths,
}: PublishHtmlArtifactConfirmContentProps) => {
  const { t } = useTranslation('chat');
  const hasLocalFiles = inlinedPaths.length > 0 || uploadedPaths.length > 0;

  return (
    <ScrollArea
      disableContentFit
      scrollFade
      style={{ maxHeight: CONFIRM_BODY_MAX_HEIGHT, overflow: 'hidden' }}
      viewportProps={{ style: { height: 'auto', maxHeight: CONFIRM_BODY_MAX_HEIGHT } }}
    >
      <Flexbox gap={8} style={{ paddingBlock: 12, paddingInline: 16 }}>
        <Text>{t('workingPanel.localFile.publish.privacy')}</Text>
        {!hasLocalFiles && <Text>{t('workingPanel.localFile.publish.noLocalFiles')}</Text>}
        {inlinedPaths.length > 0 && (
          <>
            <Text>
              {t('workingPanel.localFile.publish.inline', {
                count: inlinedPaths.length,
                limit: inlineLimit,
              })}
            </Text>
            <PathList items={inlinedPaths} />
          </>
        )}
        {uploadedPaths.length > 0 && (
          <>
            <Text>
              {t('workingPanel.localFile.publish.upload', { count: uploadedPaths.length })}
            </Text>
            <PathList items={uploadedPaths} />
          </>
        )}
        {missing.length > 0 && (
          <Text type={'secondary'}>
            {t('workingPanel.localFile.publish.missing', { list: missing.join(', ') })}
          </Text>
        )}
        {oversized.length > 0 && (
          <Text type={'secondary'}>
            {t('workingPanel.localFile.publish.oversized', { list: oversized.join(', ') })}
          </Text>
        )}
        {remotes.length > 0 && (
          <>
            <Text>{t('workingPanel.localFile.publish.remotes')}</Text>
            <PathList items={remotes} />
          </>
        )}
        <Text type={'secondary'}>{t('workingPanel.localFile.publish.dynamic')}</Text>
        <Text type={'secondary'}>{t('workingPanel.localFile.publish.note')}</Text>
      </Flexbox>
    </ScrollArea>
  );
};

export const PublishHtmlArtifactConfirmFooter = ({
  okText,
  onOk,
}: {
  okText: string;
  onOk: () => void;
}) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();

  return (
    <Flexbox
      horizontal
      gap={8}
      justify={'flex-end'}
      style={{ paddingBlock: 12, paddingInline: 16 }}
    >
      <Button
        onClick={() => {
          close();
        }}
      >
        {t('cancel')}
      </Button>
      <Button
        type={'primary'}
        onClick={() => {
          close();
          onOk();
        }}
      >
        {okText}
      </Button>
    </Flexbox>
  );
};
