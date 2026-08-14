'use client';

import { EyeIcon, EyeOffIcon, PencilIcon, PlayIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';

import type { PolicyOption } from './PolicySelect';

/**
 * The workspace General-access options offered on a Permission page, shared by
 * every permission-capable resource so no two surfaces can drift into naming
 * the same level differently. The level set and descriptions come from the
 * resource type (Agent/Group: edit+use, Document: edit+view, Knowledge Base:
 * edit+use with browse-specific wording).
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
  resourceType?: PermissionResourceType;
}): PolicyOption<ResourceAccessLevel>[] => {
  const { accessLevel, isPrivate, resourceType = 'agent' } = params;
  const { t } = useTranslation('setting');

  return useMemo(() => {
    // Knowledge bases speak the access axis, not the edit axis: the `edit`
    // level's real grant is "members may open it and see the files inside",
    // and `use` means "hidden from members, AI retrieval only" — calling
    // those "Can edit" / "Can use" would promise capabilities the row-level
    // creator gates never hand out.
    if (resourceType === 'knowledgeBase') {
      return [
        {
          desc: t('permission.generalAccess.kbAccessibleDesc'),
          icon: EyeIcon,
          label: t(
            isPrivate
              ? 'permission.page.kbAccessibleWhenShared'
              : 'permission.generalAccess.kbAccessible',
          ),
          value: 'edit',
        },
        {
          desc: t('permission.generalAccess.kbNoAccessDesc'),
          icon: EyeOffIcon,
          label: t(
            isPrivate
              ? 'permission.page.kbNoAccessWhenShared'
              : 'permission.generalAccess.kbNoAccess',
          ),
          value: 'use',
        },
      ] satisfies PolicyOption<ResourceAccessLevel>[];
    }

    const options: PolicyOption<ResourceAccessLevel>[] = [
      {
        desc: t(
          resourceType === 'document'
            ? 'permission.generalAccess.editableDocumentDesc'
            : 'permission.generalAccess.editableDesc',
        ),
        icon: PencilIcon,
        label: t(
          isPrivate ? 'permission.page.editableWhenShared' : 'permission.generalAccess.editable',
        ),
        value: 'edit',
      },
    ];

    if (resourceType === 'document') {
      options.push({
        desc: t('permission.generalAccess.viewableDocumentDesc'),
        icon: EyeIcon,
        label: t(
          isPrivate ? 'permission.page.viewableWhenShared' : 'permission.generalAccess.viewable',
        ),
        value: 'view',
      });
    } else {
      options.push({
        desc: t('permission.generalAccess.usableDesc'),
        icon: PlayIcon,
        label: t(
          isPrivate ? 'permission.page.usableWhenShared' : 'permission.generalAccess.usable',
        ),
        value: 'use',
      });
    }

    // `view` is a document-native level, but a legacy row on other types can
    // still carry it — list it so the control shows the real current value
    // instead of blank.
    if (accessLevel === 'view' && resourceType !== 'document') {
      options.push({
        desc: t('permission.generalAccess.viewableDesc'),
        icon: EyeIcon,
        label: t('permission.generalAccess.viewable'),
        value: 'view',
      });
    }

    return options;
  }, [accessLevel, isPrivate, resourceType, t]);
};
