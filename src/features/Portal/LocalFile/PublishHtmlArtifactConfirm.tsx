import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import { openPublishConfirm } from '@/components/PublishConfirmModal';

import type { ReadyWorkspaceHtmlPublishPlan } from './prepareWorkspaceHtmlPublish';
import { WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES } from './readWorkspaceAsset';

const PathList = ({ items }: { items: string[] }) => (
  <Flexbox gap={4}>
    {items.map((item) => (
      <Text key={item} style={{ wordBreak: 'break-all' }} type={'secondary'}>
        {item}
      </Text>
    ))}
  </Flexbox>
);

interface PublishHtmlArtifactDetailsProps {
  inlinedPaths: string[];
  inlineLimit: string;
  missing: string[];
  oversized: string[];
  remotes: string[];
  unsupported: string[];
  uploadedPaths: string[];
}

const PublishHtmlArtifactDetails = ({
  inlineLimit,
  inlinedPaths,
  missing,
  oversized,
  remotes,
  unsupported,
  uploadedPaths,
}: PublishHtmlArtifactDetailsProps) => {
  const { t } = useTranslation('chat');
  const showDetails = [inlinedPaths, uploadedPaths, missing, oversized, remotes, unsupported].some(
    (list) => list.length > 0,
  );

  if (!showDetails) return null;

  return (
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
              {unsupported.length > 0 && (
                <Text type={'secondary'}>
                  {t('workingPanel.localFile.publish.unsupported', {
                    list: unsupported.join(', '),
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

  openPublishConfirm({
    details: (
      <PublishHtmlArtifactDetails
        inlineLimit={`${WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES / 1024} KB`}
        inlinedPaths={plan.packed.inlinedPaths}
        missing={plan.gathered.missing}
        oversized={plan.gathered.oversized}
        remotes={plan.gathered.remotes}
        unsupported={plan.gathered.unsupported}
        uploadedPaths={plan.packed.sidecars.map((file) => file.path)}
      />
    ),
    note: t('workingPanel.localFile.publish.note', { ns: 'chat' }),
    okText,
    onOk,
  });
};
