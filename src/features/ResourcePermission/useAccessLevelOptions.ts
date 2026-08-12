'use client';

import { EyeIcon, PencilIcon, PlayIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ResourceAccessLevel } from '@/services/resourcePermission';

import type { PolicyOption } from './PolicySelect';

/**
 * The workspace General-access options offered on a Permission page, shared by
 * Agent and Agent Group so the two surfaces can never drift into naming the
 * same level differently.
 *
 * `isPrivate` only changes the *label tense*: a still-private resource has no
 * members yet, so "Can edit" would describe a state that does not exist —
 * "Can edit when shared" says the same decision is being configured ahead of
 * publishing. The descriptions explain what the level itself means and stay as
 * they are either way.
 */
export const useAccessLevelOptions = (params: {
  /** Current level — a legacy `view` row is listed so the control shows it. */
  accessLevel?: ResourceAccessLevel;
  isPrivate: boolean;
}): PolicyOption<ResourceAccessLevel>[] => {
  const { accessLevel, isPrivate } = params;
  const { t } = useTranslation('setting');

  return useMemo(() => {
    const options: PolicyOption<ResourceAccessLevel>[] = [
      {
        desc: t('permission.generalAccess.editableDesc'),
        icon: PencilIcon,
        label: t(
          isPrivate ? 'permission.page.editableWhenShared' : 'permission.generalAccess.editable',
        ),
        value: 'edit',
      },
      {
        desc: t('permission.generalAccess.usableDesc'),
        icon: PlayIcon,
        label: t(
          isPrivate ? 'permission.page.usableWhenShared' : 'permission.generalAccess.usable',
        ),
        value: 'use',
      },
    ];

    // `view` is a document-only level, but a legacy row can still carry it —
    // list it so the control shows the real current value instead of blank.
    if (accessLevel === 'view') {
      options.push({
        desc: t('permission.generalAccess.viewableDesc'),
        icon: EyeIcon,
        label: t('permission.generalAccess.viewable'),
        value: 'view',
      });
    }

    return options;
  }, [accessLevel, isPrivate, t]);
};
