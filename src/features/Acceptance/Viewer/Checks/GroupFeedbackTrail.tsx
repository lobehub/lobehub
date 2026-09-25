'use client';

import type { AcceptanceGroupFeedback } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { MessageSquareText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import { AttachmentThumbs } from '../Evidence/attachments';

/** Read-only group feedback trail shared by the full viewer and lightweight embeds. */
export const GroupFeedbackTrail = memo<{
  currentRound: number;
  entries: AcceptanceGroupFeedback[];
}>(({ currentRound, entries }) => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();

  if (entries.length === 0) return null;

  return (
    <Flexbox gap={10} paddingBlock={10} paddingInline={16}>
      {[...entries].reverse().map((entry) => {
        const stale = entry.roundIndex < currentRound;
        return (
          <Flexbox
            gap={4}
            key={`${entry.createdAt}-${entry.roundIndex}`}
            style={stale ? { opacity: 0.55 } : undefined}
          >
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon
                color={stale ? cssVar.colorTextQuaternary : cssVar.colorError}
                icon={MessageSquareText}
                size={13}
              />
              <Text
                style={{
                  color: stale ? cssVar.colorTextTertiary : cssVar.colorError,
                  fontSize: 12,
                }}
              >
                {t('acceptance.group.feedbackLabel')}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {hydrated ? dayjs(entry.createdAt).format('MM-DD HH:mm') : null}
              </Text>
            </Flexbox>
            <Text style={{ fontSize: 12 }}>{entry.comment}</Text>
            <AttachmentThumbs attachments={entry.attachments} />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

GroupFeedbackTrail.displayName = 'AcceptanceGroupFeedbackTrail';
