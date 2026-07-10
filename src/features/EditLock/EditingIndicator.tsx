'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon, PencilIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';

interface EditingIndicatorProps {
  /** The member currently holding the edit lock, or null/undefined when free. */
  holderId?: string | null;
  /**
   * True while the lock state is still being resolved (editor read-only). Shows a
   * "checking…" hint so the user understands why they can't edit yet.
   */
  pending?: boolean;
}

/**
 * Subtle edit-lock badge for any editable resource: a "checking…" hint while the
 * lock resolves, then "someone else is editing" if another member holds it.
 * Renders nothing once the resource is confirmed free.
 */
const EditingIndicator = memo<EditingIndicatorProps>(({ holderId, pending }) => {
  const { t } = useTranslation('file');
  const holder = useAuthorInfo(holderId ?? undefined);

  if (!holderId) {
    if (!pending) return null;

    const checkingLabel = t('pageEditor.editMode.checking');
    return (
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon spin icon={Loader2Icon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 200 }}>
          {checkingLabel}
        </Text>
      </Flexbox>
    );
  }

  const label = holder?.fullName
    ? t('pageEditor.editMode.lockedByOther', { name: holder.fullName })
    : t('pageEditor.editMode.lockedBySomeone');

  return (
    <Tooltip title={label}>
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon icon={PencilIcon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 200 }}>
          {label}
        </Text>
      </Flexbox>
    </Tooltip>
  );
});

export default EditingIndicator;
