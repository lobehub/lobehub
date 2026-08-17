import { ActionIcon, copyToClipboard, Flexbox } from '@lobehub/ui';
import { Button, createModal, toast } from '@lobehub/ui/base-ui';
import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceHtmlArtifactPublish } from '@/business/client/features/WorkspaceHtmlArtifactPublish';
import { isHtmlFile } from '@/components/HtmlPreview';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { createWorkspaceHtmlArtifactIdentifier } from './collectHtmlLocalResources';
import { gatherWorkspaceHtmlArtifact } from './gatherWorkspaceHtmlArtifact';
import { packWorkspaceHtmlDocument } from './packWorkspaceHtmlDocument';
import {
  PublishHtmlArtifactConfirmContent,
  PublishHtmlArtifactConfirmFooter,
} from './PublishHtmlArtifactConfirm';
import { readWorkspaceAsset, WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES } from './readWorkspaceAsset';

interface PublishHtmlArtifactButtonProps {
  content: string;
  deviceId?: string;
  filePath: string;
  sandboxTopicId?: string;
  topicId?: string | null;
  workingDirectory: string;
}

const relativeHtmlPath = (filePath: string, workingDirectory: string) => {
  const target = filePath.replaceAll('\\', '/');
  const root = workingDirectory.replaceAll('\\', '/').replace(/\/$/u, '');
  if (target === root) return filePath.split(/[/\\]/).at(-1) ?? filePath;
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1);
  return filePath.split(/[/\\]/).at(-1) ?? filePath;
};

export const PublishHtmlArtifactButton = ({
  content,
  deviceId,
  filePath,
  sandboxTopicId,
  topicId,
  workingDirectory,
}: PublishHtmlArtifactButtonProps) => {
  const { t } = useTranslation(['chat', 'portal', 'common']);
  const enabled = useUserStore(labPreferSelectors.enableArtifactDeployment);
  const agentId = useChatStore((s) => s.activeAgentId);
  const { available, getExisting, publish } = useWorkspaceHtmlArtifactPublish();
  const [busy, setBusy] = useState<'publishing' | 'scanning' | null>(null);
  const [publicUrl, setPublicUrl] = useState<string>();
  const [hasExisting, setHasExisting] = useState(false);

  const identifier = useMemo(
    () => createWorkspaceHtmlArtifactIdentifier(relativeHtmlPath(filePath, workingDirectory)),
    [filePath, workingDirectory],
  );

  useEffect(() => {
    if (!available || !topicId) {
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
  }, [available, getExisting, identifier, topicId]);

  const handleCopy = useCallback(async () => {
    if (!publicUrl) return;
    await copyToClipboard(publicUrl);
    toast.success(t('artifacts.deploy.copySuccess', { ns: 'portal' }));
  }, [publicUrl, t]);

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
          error instanceof Error && error.message
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
      const gathered = await gatherWorkspaceHtmlArtifact({
        htmlContent: content,
        htmlFilePath: filePath,
        readAsset: (absolutePath) =>
          readWorkspaceAsset({
            deviceId,
            path: absolutePath,
            sandboxTopicId,
            workingDirectory,
          }),
        workingDirectory,
      });

      if (gathered.blocked === 'too-many' || gathered.blocked === 'too-large') {
        toast.error(
          t(
            gathered.blocked === 'too-many'
              ? 'workingPanel.localFile.publish.tooMany'
              : 'workingPanel.localFile.publish.tooLarge',
            { size: gathered.totalBytes },
          ),
        );
        return;
      }

      const packed = packWorkspaceHtmlDocument({
        entryPath: gathered.entryPath,
        files: gathered.files,
      });
      const okText = t(
        hasExisting
          ? 'workingPanel.localFile.publish.version'
          : 'workingPanel.localFile.publish.action',
      );
      createModal({
        content: (
          <PublishHtmlArtifactConfirmContent
            inlineLimit={`${WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES / 1024} KB`}
            inlinedPaths={packed.inlinedPaths}
            missing={gathered.missing}
            oversized={gathered.oversized}
            remotes={gathered.remotes}
            uploadedPaths={packed.sidecars.map((file) => file.path)}
          />
        ),
        footer: (
          <PublishHtmlArtifactConfirmFooter
            okText={okText}
            onOk={() => {
              void runPublish(gathered);
            }}
          />
        ),
        styles: {
          content: { minHeight: 0, overflow: 'hidden', padding: 0 },
        },
        title: t('workingPanel.localFile.publish.confirmTitle'),
        width: 420,
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

  if (!enabled || !available || !isHtmlFile({ path: filePath })) return null;

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Button
        disabled={!topicId}
        loading={!!busy}
        size={'small'}
        title={topicId ? undefined : t('workingPanel.localFile.publish.noTopic')}
        onClick={() => {
          void handlePublish();
        }}
      >
        {t(
          hasExisting
            ? 'workingPanel.localFile.publish.version'
            : 'workingPanel.localFile.publish.action',
        )}
      </Button>
      {publicUrl && (
        <>
          <ActionIcon
            icon={CopyIcon}
            size={'small'}
            title={t('artifacts.deploy.copy', { ns: 'portal' })}
            onClick={() => {
              void handleCopy();
            }}
          />
          <ActionIcon
            icon={ExternalLinkIcon}
            size={'small'}
            title={t('artifacts.deploy.open', { ns: 'portal' })}
            onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')}
          />
        </>
      )}
    </Flexbox>
  );
};
