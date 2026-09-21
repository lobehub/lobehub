'use client';

import type { AcceptanceChecklistItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { BadgeCheck, Ban, ChevronRight, CircleDashed, PencilLine, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';

import { checkFilterState } from '../Checks/checkState';
import type { AcceptanceCheck } from '../Checks/types';
import { acceptanceFocusedLayout } from '../layout';

const STATE_ICON = {
  accepted: BadgeCheck,
  ignored: Ban,
  needsFix: RotateCcw,
  pending: CircleDashed,
} as const;

const STATE_TAG_COLOR = {
  accepted: 'success',
  ignored: 'default',
  needsFix: 'error',
  pending: 'default',
} as const;

interface FocusOutlineProps {
  checks: AcceptanceCheck[];
  focusedCheckId: string;
  /** Authoring is creator-only; without it the standing group stays hidden. */
  onEditStandingCheck?: (item: AcceptanceChecklistItem) => void;
  onSelectCheck: (id: string) => void;
  /** Checklist items that no round has executed yet. */
  standingChecks?: AcceptanceChecklistItem[];
}

/**
 * The list of checks beside (desktop) or above (phone) the one being read.
 *
 * Each row carries its own verdict and evidence count, because the reviewer
 * picks the next check by how much judging it still needs, not by its title.
 */
export const FocusOutline = memo<FocusOutlineProps>(
  ({ checks, focusedCheckId, onEditStandingCheck, onSelectCheck, standingChecks = [] }) => {
    const { t } = useTranslation('verify');

    return (
      <>
        {checks.map((check) => {
          const state = checkFilterState(check);

          return (
            <NavItem
              active={check.id === focusedCheckId}
              extra={<Icon color={cssVar.colorTextQuaternary} icon={ChevronRight} size={14} />}
              key={check.id}
              paddingBlock={acceptanceFocusedLayout.outlineItemPaddingBlock}
              paddingInline={acceptanceFocusedLayout.outlineItemPaddingInline}
              title={check.title}
              titleColor={cssVar.colorText}
              description={
                <Flexbox horizontal align={'center'} gap={8}>
                  <Tag
                    color={STATE_TAG_COLOR[state]}
                    icon={<Icon icon={STATE_ICON[state]} />}
                    size={'small'}
                  >
                    {t(`acceptance.focus.state.${state}`)}
                  </Tag>
                  <Text fontSize={12} type={'secondary'}>
                    {t('acceptance.focus.evidenceCount', { count: check.evidence.length })}
                  </Text>
                </Flexbox>
              }
              slots={{
                titlePrefix: (
                  <Flexbox align={'center'} height={22} style={{ alignSelf: 'flex-start' }}>
                    <Text
                      style={{
                        color: cssVar.colorTextQuaternary,
                        fontFamily: cssVar.fontFamilyCode,
                        fontSize: 11,
                      }}
                    >
                      C{check.seq}
                    </Text>
                  </Flexbox>
                ),
              }}
              onClick={() => onSelectCheck(check.id)}
            />
          );
        })}
        {standingChecks.length > 0 && onEditStandingCheck && (
          <Flexbox gap={4} paddingBlock={8} paddingInline={8}>
            <Text fontSize={11} type={'secondary'}>
              {t('acceptance.checkCreate.pendingGroup')}
            </Text>
            {standingChecks.map((item) => (
              <NavItem
                extra={<Icon color={cssVar.colorTextQuaternary} icon={PencilLine} />}
                key={item.id}
                paddingBlock={acceptanceFocusedLayout.outlineItemPaddingBlock}
                paddingInline={acceptanceFocusedLayout.outlineItemPaddingInline}
                title={item.name}
                titleColor={cssVar.colorText}
                description={
                  <Text fontSize={12} type={'secondary'}>
                    {item.method || t('acceptance.checkCreate.pendingDescription')}
                  </Text>
                }
                onClick={() => onEditStandingCheck(item)}
              />
            ))}
          </Flexbox>
        )}
      </>
    );
  },
);

FocusOutline.displayName = 'AcceptanceFocusOutline';
