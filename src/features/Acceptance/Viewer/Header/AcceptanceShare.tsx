import { getCanonicalAppOrigin } from '@lobechat/utils/url';
import { Button, confirmModal, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance } from '../visibility';

/** A write capability: read-only hosts never mount sharing controls. */
const AcceptanceShare = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  if (!canReviewAcceptance(data)) return null;

  const isPublic = data?.acceptance.visibility === 'public';
  const changeVisibility = () =>
    confirmModal({
      cancelText: t('actions.cancel'),
      content: t(isPublic ? 'acceptance.share.privateHint' : 'acceptance.share.publicHint'),
      okText: t(isPublic ? 'acceptance.share.makePrivate' : 'acceptance.share.makePublic'),
      title: t(isPublic ? 'acceptance.share.makePrivate' : 'acceptance.share.makePublic'),
      onOk: async () => {
        try {
          await verifyService.setAcceptanceVisibility(
            acceptanceId,
            isPublic ? 'private' : 'public',
          );
          await mutate();
          void globalMutate(isAcceptanceListKey);
          toast.success(t('acceptance.share.saved'));
        } catch (error) {
          toast.error(t('acceptance.actionError'));
          throw error;
        }
      },
    });

  return (
    <DropdownMenu
      items={[
        {
          key: 'visibility',
          label: t(isPublic ? 'acceptance.share.makePrivate' : 'acceptance.share.makePublic'),
          onClick: changeVisibility,
        },
        {
          key: 'copy',
          label: t('report.actions.copyLink'),
          onClick: async () => {
            try {
              const url = new URL(
                `/acceptance/${acceptanceId}`,
                getCanonicalAppOrigin(window.location.origin),
              );
              await navigator.clipboard.writeText(url.toString());
              toast.success(t('report.actions.copyLinkSuccess'));
            } catch {
              toast.error(t('acceptance.share.copyFailed'));
            }
          },
        },
      ]}
    >
      <Button icon={Share2} size={'small'}>
        {t('acceptance.share.title')}
      </Button>
    </DropdownMenu>
  );
};

export default AcceptanceShare;
