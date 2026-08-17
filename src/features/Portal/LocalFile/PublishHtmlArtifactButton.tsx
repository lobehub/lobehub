import { ActionIcon, CopyButton, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceHtmlArtifactPublish } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { isHtmlFile } from '@/components/HtmlPreview';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { createWorkspaceHtmlArtifactIdentifier } from './collectHtmlLocalResources';
import {
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
} from './prepareWorkspaceHtmlPublish';
import { openWorkspaceHtmlPublishConfirm } from './PublishHtmlArtifactConfirm';
import { getPublishHtmlArtifactSlots } from './publishHtmlArtifactUi';

interface PublishHtmlArtifactButtonProps {
  children?: ReactNode;
  content: string;
  deviceId?: string;
  filePath: string;
  sandboxTopicId?: string;
  topicId?: string | null;
  workingDirectory: string;
}

interface PublishHtmlArtifactModel {
  busy: 'publishing' | 'scanning' | null;
  handlePublish: () => void;
  publicUrl?: string;
  showLiveBar: boolean;
  showOverlayTrigger: boolean;
  topicId?: string | null;
}

const liveBarStyles = createStaticStyles(({ css }) => ({
  bar: css`
    flex-shrink: 0;

    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  url: css`
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM}px;
  `,
}));

const PublishHtmlArtifactContext = createContext<PublishHtmlArtifactModel | null>(null);

const relativeHtmlPath = (filePath: string, workingDirectory: string) => {
  const target = filePath.replaceAll('\\', '/');
  const root = workingDirectory.replaceAll('\\', '/').replace(/\/$/u, '');
  if (target === root) return filePath.split(/[/\\]/).at(-1) ?? filePath;
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1);
  return filePath.split(/[/\\]/).at(-1) ?? filePath;
};

const usePublishHtmlArtifactModel = ({
  content,
  deviceId,
  filePath,
  sandboxTopicId,
  topicId,
  workingDirectory,
}: Omit<PublishHtmlArtifactButtonProps, 'children'>): PublishHtmlArtifactModel => {
  const { t } = useTranslation(['chat', 'portal', 'common']);
  const enabled = useUserStore(labPreferSelectors.enableArtifactDeployment);
  const agentId = useChatStore((s) => s.activeAgentId);
  const { available, getExisting, publish } = useWorkspaceHtmlArtifactPublish();
  const [busy, setBusy] = useState<'publishing' | 'scanning' | null>(null);
  const [publicUrl, setPublicUrl] = useState<string>();
  const [hasExisting, setHasExisting] = useState(false);

  const isHtml = isHtmlFile({ path: filePath });
  const identifier = useMemo(
    () => createWorkspaceHtmlArtifactIdentifier(relativeHtmlPath(filePath, workingDirectory)),
    [filePath, workingDirectory],
  );

  useEffect(() => {
    if (!available || !enabled || !isHtml || !topicId) {
      setHasExisting(false);
      setPublicUrl(undefined);
      return;
    }

    let cancelled = false;
    void getExisting({ identifier, topicId }).then((existing) => {
      if (cancelled) return;
      setHasExisting(!!existing);
      setPublicUrl(existing?.publicUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [available, enabled, getExisting, identifier, isHtml, topicId]);

  const runPublish = useCallback(
    async (gathered: Awaited<ReturnType<typeof gatherWorkspaceHtmlArtifact>>) => {
      if (!topicId) return;

      setBusy('publishing');
      try {
        const result = await publish({
          agentId: agentId ?? undefined,
          entryPath: gathered.entryPath,
          files: gathered.files,
          identifier: gathered.identifier,
          title: gathered.title,
          topicId,
        });

        setHasExisting(true);
        if (result.publicUrl) setPublicUrl(result.publicUrl);
        toast.success(t('workingPanel.localFile.publish.success'));
      } catch (error) {
        toast.error(
          error instanceof Error && error.message === 'unresolved-local-assets'
            ? t('workingPanel.localFile.publish.unresolvedLocals')
            : error instanceof Error && error.message
              ? error.message
              : t('workingPanel.localFile.publish.failed'),
        );
      } finally {
        setBusy(null);
      }
    },
    [agentId, publish, t, topicId],
  );

  const handlePublish = useCallback(async () => {
    if (!topicId || busy) return;

    setBusy('scanning');
    try {
      const plan = await prepareWorkspaceHtmlPublish({
        content,
        deviceId,
        filePath,
        hasExisting,
        sandboxTopicId,
        topicId,
        workingDirectory,
      });

      if ('blocked' in plan) {
        notifyWorkspaceHtmlPublishBlocked(plan);
        return;
      }

      openWorkspaceHtmlPublishConfirm({
        plan,
        onOk: () => {
          void runPublish(plan.gathered);
        },
      });
    } catch {
      toast.error(t('workingPanel.localFile.publish.failed'));
    } finally {
      setBusy((current) => (current === 'scanning' ? null : current));
    }
  }, [
    busy,
    content,
    deviceId,
    filePath,
    hasExisting,
    runPublish,
    sandboxTopicId,
    t,
    topicId,
    workingDirectory,
  ]);

  const slots = getPublishHtmlArtifactSlots({
    available,
    enabled,
    isHtml,
    publicUrl,
  });

  return {
    busy,
    handlePublish,
    publicUrl,
    topicId,
    ...slots,
  };
};

export const PublishHtmlArtifactProvider = ({
  children,
  ...input
}: PublishHtmlArtifactButtonProps) => {
  const model = usePublishHtmlArtifactModel(input);

  return <PublishHtmlArtifactContext value={model}>{children}</PublishHtmlArtifactContext>;
};

const PublishAction = () => {
  const { t } = useTranslation('chat');
  const model = use(PublishHtmlArtifactContext);
  if (!model) return null;

  return (
    <Button
      disabled={!model.topicId}
      loading={!!model.busy}
      size={'small'}
      title={model.topicId ? undefined : t('workingPanel.localFile.publish.noTopic')}
      onClick={() => {
        void model.handlePublish();
      }}
    >
      {t(
        model.publicUrl
          ? 'workingPanel.localFile.publish.version'
          : 'workingPanel.localFile.publish.action',
      )}
    </Button>
  );
};

export const PublishHtmlArtifactLiveBar = () => {
  const { t } = useTranslation(['chat', 'portal']);
  const model = use(PublishHtmlArtifactContext);
  if (!model?.showLiveBar || !model.publicUrl) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={liveBarStyles.bar}
      gap={8}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
        <Tag color={'success'} style={{ marginInlineEnd: 0 }}>
          {t('workingPanel.localFile.publish.live')}
        </Tag>
        <Text ellipsis className={liveBarStyles.url}>
          {model.publicUrl}
        </Text>
        <CopyButton content={model.publicUrl} size={'small'} />
        <ActionIcon
          icon={ExternalLinkIcon}
          size={'small'}
          title={t('artifacts.deploy.open', { ns: 'portal' })}
          onClick={() => window.open(model.publicUrl, '_blank', 'noopener,noreferrer')}
        />
      </Flexbox>
      <Flexbox flex={'none'}>
        <PublishAction />
      </Flexbox>
    </Flexbox>
  );
};

export const PublishHtmlArtifactTrigger = () => {
  const model = use(PublishHtmlArtifactContext);
  if (!model?.showOverlayTrigger) return null;

  return <PublishAction />;
};

export const PublishHtmlArtifactButton = (props: PublishHtmlArtifactButtonProps) => (
  <PublishHtmlArtifactProvider {...props}>
    <PublishHtmlArtifactTrigger />
  </PublishHtmlArtifactProvider>
);
