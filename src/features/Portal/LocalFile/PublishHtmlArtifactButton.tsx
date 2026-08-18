import { ActionIcon, CopyButton, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceHtmlArtifactExisting } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { useWorkspaceHtmlArtifactPublish } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { isHtmlFile } from '@/components/HtmlPreview';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import {
  notifyWorkspaceHtmlPublishBlocked,
  prepareWorkspaceHtmlPublish,
  publishPreparedWorkspaceHtml,
  type ReadyWorkspaceHtmlPublishPlan,
} from './prepareWorkspaceHtmlPublish';
import { openWorkspaceHtmlPublishConfirm } from './PublishHtmlArtifactConfirm';
import { workspaceHtmlArtifactIdentifierForFile } from './workspaceHtmlPath';

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

export const usePublishHtmlArtifactModel = ({
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
  const [existing, setExisting] = useState<WorkspaceHtmlArtifactExisting | null>(null);

  const isHtml = isHtmlFile({ path: filePath });
  const identifier = useMemo(
    () => workspaceHtmlArtifactIdentifierForFile(filePath, workingDirectory),
    [filePath, workingDirectory],
  );

  const scopeKey = `${topicId ?? ''}:${identifier}`;
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    setExisting(null);
    if (!available || !enabled || !isHtml || !topicId) return;

    let cancelled = false;
    void getExisting({ identifier, topicId }).then((result) => {
      if (!cancelled) setExisting(result);
    });

    return () => {
      cancelled = true;
    };
  }, [available, enabled, getExisting, identifier, isHtml, topicId]);

  const runPublish = useCallback(
    async (plan: ReadyWorkspaceHtmlPublishPlan) => {
      if (!topicId) return;

      const requestScope = scopeRef.current;
      setBusy('publishing');
      try {
        const result = await publishPreparedWorkspaceHtml({ agentId, plan, publish, topicId });
        // Publishing may outlive a file/topic switch under the same provider;
        // a completion for a previous scope must not label the current file.
        if (!result || scopeRef.current !== requestScope) return;
        setExisting((previous) => ({
          identifier: plan.gathered.identifier,
          publicUrl: result.publicUrl ?? previous?.publicUrl,
        }));
      } finally {
        setBusy(null);
      }
    },
    [agentId, publish, topicId],
  );

  const handlePublish = useCallback(async () => {
    if (!topicId || busy) return;

    setBusy('scanning');
    try {
      const plan = await prepareWorkspaceHtmlPublish({
        content,
        deviceId,
        filePath,
        sandboxTopicId,
        workingDirectory,
      });

      if ('blocked' in plan) {
        notifyWorkspaceHtmlPublishBlocked(plan);
        return;
      }

      openWorkspaceHtmlPublishConfirm({
        hasExisting: !!existing,
        plan,
        onOk: () => {
          void runPublish(plan);
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
    existing,
    filePath,
    runPublish,
    sandboxTopicId,
    t,
    topicId,
    workingDirectory,
  ]);

  const publicUrl = existing?.publicUrl;
  const visible = available && enabled && isHtml;

  return {
    busy,
    handlePublish,
    publicUrl,
    showLiveBar: visible && !!publicUrl,
    showOverlayTrigger: visible && !publicUrl,
    topicId,
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
