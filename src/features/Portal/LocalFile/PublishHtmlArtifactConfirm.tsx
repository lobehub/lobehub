import { Flexbox } from '@lobehub/ui';
import {
  Accordion,
  Button,
  createModal,
  ScrollArea,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { ReadyWorkspaceHtmlPublishPlan } from './prepareWorkspaceHtmlPublish';
import { WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES } from './readWorkspaceAsset';

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

const PublishHtmlArtifactConfirmContent = ({
  inlineLimit,
  inlinedPaths,
  missing,
  oversized,
  remotes,
  uploadedPaths,
}: PublishHtmlArtifactConfirmContentProps) => {
  const { t } = useTranslation('chat');
  const showDetails = [inlinedPaths, uploadedPaths, missing, oversized, remotes].some(
    (list) => list.length > 0,
  );

  return (
    <ScrollArea
      disableContentFit
      scrollFade
      style={{ maxHeight: CONFIRM_BODY_MAX_HEIGHT, overflow: 'hidden' }}
      viewportProps={{ style: { height: 'auto', maxHeight: CONFIRM_BODY_MAX_HEIGHT } }}
    >
      <Flexbox gap={8} style={{ paddingBlock: 12, paddingInline: 16 }}>
        <Text>{t('workingPanel.localFile.publish.privacy')}</Text>
        {showDetails && (
          <Accordion
            indicatorPlacement={'start'}
            variant={'borderless'}
            items={[
              {
                children: (
                  <Flexbox gap={8} paddingBlock={'4px 0'}>
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
                          {t('workingPanel.localFile.publish.upload', {
                            count: uploadedPaths.length,
                          })}
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
                        {t('workingPanel.localFile.publish.oversized', {
                          list: oversized.join(', '),
                        })}
                      </Text>
                    )}
                    {remotes.length > 0 && (
                      <>
                        <Text>{t('workingPanel.localFile.publish.remotes')}</Text>
                        <PathList items={remotes} />
                      </>
                    )}
                    <Text type={'secondary'}>{t('workingPanel.localFile.publish.dynamic')}</Text>
                  </Flexbox>
                ),
                key: 'details',
                title: (
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {t('workingPanel.localFile.publish.details')}
                  </Text>
                ),
              },
            ]}
          />
        )}
        <Text type={'secondary'}>{t('workingPanel.localFile.publish.note')}</Text>
      </Flexbox>
    </ScrollArea>
  );
};

const PublishHtmlArtifactConfirmFooter = ({
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

export const openWorkspaceHtmlPublishConfirm = ({
  hasExisting,
  onOk,
  plan,
}: {
  hasExisting: boolean;
  onOk: () => void;
  plan: ReadyWorkspaceHtmlPublishPlan;
}) => {
  const okText = t(
    hasExisting
      ? 'workingPanel.localFile.publish.version'
      : 'workingPanel.localFile.publish.action',
    { ns: 'chat' },
  );

  createModal({
    content: (
      <PublishHtmlArtifactConfirmContent
        inlineLimit={`${WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES / 1024} KB`}
        inlinedPaths={plan.packed.inlinedPaths}
        missing={plan.gathered.missing}
        oversized={plan.gathered.oversized}
        remotes={plan.gathered.remotes}
        uploadedPaths={plan.packed.sidecars.map((file) => file.path)}
      />
    ),
    footer: <PublishHtmlArtifactConfirmFooter okText={okText} onOk={onOk} />,
    styles: {
      content: { minHeight: 0, overflow: 'hidden', padding: 0 },
    },
    title: t('workingPanel.localFile.publish.confirmTitle', { ns: 'chat' }),
    width: 420,
  });
};
