'use client';

import type { FileShareSettings, FileShareVisibility } from '@lobechat/types';
import { fileShareUrl } from '@lobechat/utils/fileShare';
import {
  Button,
  copyToClipboard,
  Flexbox,
  Input,
  Skeleton,
  Switch,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { CopyIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import SocialShare from '@/features/SocialShare';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { mutate as globalMutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

export type GenerationShareType = 'image' | 'music' | 'video';

/**
 * Same key as the file share button in the resource library and file preview,
 * so every entry to one file's share shows the same state.
 */
const FILE_SHARE_SETTINGS_KEY = (fileId: string) => ['fileShare.getShareSettings', fileId];

export interface GenerationShareContentProps {
  /** Library file the generation was saved as; the share link is that file's. */
  fileId: string;
  /** Prompt of the batch; leads the post when there is no title. */
  prompt?: string;
  /** Song title, when the generation has one. */
  title?: string;
  type: GenerationShareType;
}

/**
 * The owner's share panel for one generation: the public-link switch of the
 * file it was saved as, the link, and the four-channel social share.
 */
const GenerationShareContent = memo<GenerationShareContentProps>(
  ({ fileId, prompt, title, type }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const appOrigin = useAppOrigin();
    const [updating, setUpdating] = useState(false);
    const [updateError, setUpdateError] = useState<InlineErrorState | null>(null);

    const { data, error, isLoading, mutate } = useSWR(
      FILE_SHARE_SETTINGS_KEY(fileId),
      () => lambdaClient.fileShare.getShareSettings.query({ fileId }),
      { revalidateOnFocus: false },
    );

    const isPublic = data?.visibility === 'link';
    const shareUrl = isPublic ? fileShareUrl(appOrigin, data.shareId) : undefined;

    const setVisibility = useCallback(
      async (visibility: FileShareVisibility) => {
        setUpdating(true);
        setUpdateError(null);
        let next: FileShareSettings | null;
        try {
          next = await lambdaClient.fileShare.updateShareSettings.mutate({ fileId, visibility });
          await globalMutate(FILE_SHARE_SETTINGS_KEY(fileId), next, { revalidate: false });
        } catch (error) {
          console.error('[GenerationShare] Failed to update share settings:', error);
          setUpdateError(toInlineError(t('shareModal.generation.updateFailedRetry'), error));
          return;
        } finally {
          setUpdating(false);
        }

        if (visibility !== 'link' || !next) {
          toast.success(t('shareModal.generation.disabled'));
          return;
        }

        // Turning the link on is the moment people want it: copy it right away.
        // The link is already live, so a refused clipboard is not a failed update.
        try {
          await copyToClipboard(fileShareUrl(appOrigin, next.shareId));
          toast.success(t('shareModal.generation.enabled'));
        } catch {
          toast.success(t('shareModal.generation.enabledNotCopied'));
        }
      },
      [appOrigin, fileId, t],
    );

    const copyLink = useCallback(async () => {
      if (!shareUrl) return;
      await copyToClipboard(shareUrl);
      toast.success(t('shareModal.copyLinkSuccess'));
    }, [shareUrl, t]);

    if (isLoading) return <Skeleton.Text rows={4} />;

    if (error && !data)
      return (
        <Flexbox align={'center'} gap={12} paddingBlock={16}>
          <Text type={'secondary'}>{t('shareModal.generation.loadError')}</Text>
          <Button onClick={() => mutate()}>{t('retry', { ns: 'common' })}</Button>
        </Flexbox>
      );

    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox gap={2}>
            <Text strong>{t('shareModal.generation.link.label')}</Text>
            <Text fontSize={12} type={'secondary'}>
              {t('shareModal.generation.link.desc')}
            </Text>
          </Flexbox>
          <Switch
            aria-label={t('shareModal.generation.link.label')}
            checked={isPublic}
            loading={updating}
            onChange={(checked) => setVisibility(checked ? 'link' : 'private')}
          />
        </Flexbox>

        {updateError && (
          <InlineErrorText detail={updateError.detail}>{updateError.summary}</InlineErrorText>
        )}

        {shareUrl && (
          <Flexbox horizontal gap={8}>
            <Input readOnly value={shareUrl} variant={'filled'} />
            <Button icon={CopyIcon} onClick={copyLink}>
              {t('shareModal.copyLink')}
            </Button>
          </Flexbox>
        )}

        <SocialShare
          description={t(`shareModal.social.generation.description.${type}`)}
          disabledHint={t('shareModal.generation.disabledHint')}
          shareUrl={shareUrl}
          title={title || prompt || t(`shareModal.social.generation.fallbackTitle.${type}`)}
          onLeave={close}
        />
      </Flexbox>
    );
  },
);

GenerationShareContent.displayName = 'GenerationShareContent';

export default GenerationShareContent;
