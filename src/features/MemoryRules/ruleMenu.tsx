import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import type { TFunction } from 'i18next';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightLeftIcon,
  MergeIcon,
  PencilIcon,
} from 'lucide-react';

import type { RuleGroup, RuleItem } from '@/services/expertise';

import { mergedIntoId } from './labels';

export interface RuleHandlers {
  archive: (id: string) => void;
  edit: (id: string) => void;
  merge: (id: string) => void;
  move: (id: string, domainId: string) => void;
  restore: (id: string) => void;
}

/**
 * The same `…` menu on a row and on the document header. Moving lists every other group as a
 * submenu; merging and archiving are one click because both are reversible from the archive.
 */
export const buildRuleMenu = (
  t: TFunction<'memory'>,
  rule: RuleItem,
  groups: RuleGroup[],
  h: RuleHandlers,
): DropdownItem[] => {
  const archived = rule.status === 'retired';
  const mergedInto = mergedIntoId(rule);
  const others = groups.filter((group) => group.domain.id !== rule.domainId);
  return [
    ...(archived
      ? []
      : [
          {
            icon: <Icon icon={PencilIcon} />,
            key: 'edit',
            label: t('rules.actions.edit'),
            onClick: () => h.edit(rule.id),
          },
          ...(others.length > 0
            ? [
                {
                  children: others.map((group) => ({
                    key: `move-${group.domain.id}`,
                    label: group.domain.title,
                    onClick: () => h.move(rule.id, group.domain.id),
                  })),
                  icon: <Icon icon={ArrowRightLeftIcon} />,
                  key: 'move',
                  label: t('rules.actions.move'),
                },
              ]
            : []),
          {
            icon: <Icon icon={MergeIcon} />,
            key: 'merge',
            label: t('rules.actions.merge'),
            onClick: () => h.merge(rule.id),
          },
          { type: 'divider' as const },
        ]),
    archived
      ? // A rule merged into another lives on in that one; restoring it would count it twice,
        // so the menu says where it went instead of offering to bring it back.
        mergedInto
        ? {
            disabled: true,
            key: 'merged',
            label: t('rules.archived.mergedInto', {
              title: groups.flatMap((g) => g.rules).find((r) => r.id === mergedInto)?.title ?? '',
            }),
          }
        : {
            icon: <Icon icon={ArchiveRestoreIcon} />,
            key: 'restore',
            label: t('rules.actions.restore'),
            onClick: () => h.restore(rule.id),
          }
      : {
          danger: true,
          icon: <Icon icon={ArchiveIcon} />,
          key: 'archive',
          label: t('rules.actions.archive'),
          onClick: () => h.archive(rule.id),
        },
  ];
};
