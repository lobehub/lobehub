import type { AcceptanceVisibility } from '@lobechat/const/verify';
import type { DropdownItem } from '@lobehub/ui';
import { Button, confirmModal, DropdownMenu, Icon, toast } from '@lobehub/ui';
import { Check, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance } from '../visibility';

const checkIcon = (checked: boolean) => <Icon icon={Check} style={{ opacity: checked ? 1 : 0 }} />;

const OWNER_ONLY = {
  hintKey: 'acceptance.share.ownerHint',
  labelKey: 'acceptance.share.access.owner',
} as const;
const WORKSPACE = {
  hintKey: 'acceptance.share.privateHint',
  labelKey: 'acceptance.share.access.workspace',
} as const;
const LINK = {
  hintKey: 'acceptance.share.publicHint',
  labelKey: 'acceptance.share.access.public',
} as const;

type ShareAccessOption = (typeof OWNER_ONLY | typeof WORKSPACE | typeof LINK) & {
  visibility: AcceptanceVisibility;
};

/**
 * The access levels offered for this acceptance, narrowest first. A workspace
 * delivery is shared with the team by default (`private`); its creator may keep
 * it to themselves (`owner`). A personal one has no team, so `private` already
 * means "only me".
 */
const shareAccessOptions = ({
  inWorkspace,
  isOwner,
}: {
  inWorkspace: boolean;
  isOwner: boolean;
}): ShareAccessOption[] => [
  ...(inWorkspace
    ? [
        ...(isOwner ? [{ ...OWNER_ONLY, visibility: 'owner' as const }] : []),
        { ...WORKSPACE, visibility: 'private' as const },
      ]
    : [{ ...OWNER_ONLY, visibility: 'private' as const }]),
  { ...LINK, visibility: 'public' as const },
];

/** A write capability: read-only hosts never mount sharing controls. */
const AcceptanceShare = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const appOrigin = useAppOrigin();
  if (!data || !canReviewAcceptance(data)) return null;

  const current = data.acceptance.visibility;
  const changeVisibility = ({ hintKey, labelKey, visibility }: ShareAccessOption) =>
    confirmModal({
      cancelText: t('actions.cancel'),
      content: t(hintKey),
      okText: t(labelKey),
      title: t(labelKey),
      onOk: async () => {
        try {
          await verifyService.setAcceptanceVisibility(acceptanceId, visibility);
          await mutate();
          void globalMutate(isAcceptanceListKey);
          toast.success(t('acceptance.share.saved'));
        } catch (error) {
          toast.error(t('acceptance.actionError'));
          throw error;
        }
      },
    });

  const accessGroup: DropdownItem = {
    children: shareAccessOptions({
      inWorkspace: Boolean(data.acceptance.workspaceId),
      isOwner: data.isOwner,
    }).map((option) => ({
      icon: checkIcon(current === option.visibility),
      key: `visibility-${option.visibility}`,
      label: t(option.labelKey),
      onClick: () => {
        if (current !== option.visibility) changeVisibility(option);
      },
    })),
    key: 'visibility',
    label: t('acceptance.share.access.title'),
    type: 'group',
  };

  return (
    <DropdownMenu
      items={[
        accessGroup,
        { type: 'divider' },
        {
          key: 'copy',
          label: t('report.actions.copyLink'),
          onClick: async () => {
            try {
              const url = new URL(`/acceptance/${acceptanceId}`, appOrigin);
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
