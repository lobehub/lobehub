'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Flag, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ClaimLabel } from './ClaimLabel';
import { formatVideoTime } from './videoTime';

/**
 * A submitted reject's notes on one video, read back as text in time order.
 * The frames themselves are one click away on the player above; repeating a
 * still here would show a frame without the motion the note is about.
 */
export const VideoFeedbackNotes = ({ notes }: { notes: AcceptanceReviewAnnotation[] }) => {
  const { t } = useTranslation('verify');

  return (
    <Flexbox gap={4}>
      {[...notes]
        .sort((a, b) => (a.time?.start ?? 0) - (b.time?.start ?? 0))
        .map((note, index) => (
          <Flexbox horizontal align={'baseline'} gap={8} key={index}>
            <Flexbox
              horizontal
              align={'center'}
              gap={4}
              style={{
                color: cssVar.colorErrorText,
                flex: 'none',
                fontFamily: cssVar.fontFamilyCode,
                fontSize: 11,
              }}
            >
              <Icon icon={note.time?.end === undefined ? Flag : Repeat} size={11} />
              {note.time
                ? note.time.end === undefined
                  ? formatVideoTime(note.time.start)
                  : `${formatVideoTime(note.time.start)} – ${formatVideoTime(note.time.end)}`
                : '—'}
            </Flexbox>
            <Flexbox gap={2}>
              {note.disputes?.note && (
                <Text fontSize={12} type={'secondary'}>
                  <ClaimLabel kind={note.disputes.kind} style={{ marginInlineEnd: 6 }} />
                  {note.disputes.note}
                </Text>
              )}
              <Text fontSize={12}>{note.comment || t('acceptance.video.noteEmpty')}</Text>
            </Flexbox>
          </Flexbox>
        ))}
    </Flexbox>
  );
};
