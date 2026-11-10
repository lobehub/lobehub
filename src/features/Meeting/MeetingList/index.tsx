'use client';

import { Block, Button, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { AudioLinesIcon, ChevronRightIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { MeetingListItem } from '@/services/meeting';
import { meetingActions, meetingSelectors, useMeetingStore } from '@/store/meeting';

import { formatClock } from '../format';
import { meetingDetailPath } from '../paths';
import MeetingStatusTag from '../StatusTag';

const ListSkeleton = createSurfaceSkeleton('list');

const styles = stylex.create({
  count: {
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: 99,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
  meta: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    paddingBlock: 12,
    paddingInline: 16,
    borderBlockEndWidth: { 'default': 1, ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    transition: 'background-color 120ms ease',
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillQuaternary,
      ':focus-visible': cssVar.colorFillQuaternary,
    },
  },
  rows: {
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const MeetingRow = ({ meeting }: { meeting: MeetingListItem }) => {
  const navigate = useWorkspaceAwareNavigate();
  const open = () => navigate(meetingDetailPath(meeting.id));

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.row).className}
      gap={12}
      role={'link'}
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open();
      }}
    >
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text className={stylex.props(styles.title).className} weight={500}>
            {meeting.title}
          </Text>
          <MeetingStatusTag status={meeting.status} />
        </Flexbox>
        <span className={stylex.props(styles.meta).className}>
          {dayjs(meeting.startedAt).format('YYYY-MM-DD HH:mm')}
          {meeting.durationMs ? ` · ${formatClock(meeting.durationMs)}` : ''}
        </span>
      </Flexbox>
      <Icon color={cssVar.colorTextQuaternary} icon={ChevronRightIcon} size={16} />
    </Flexbox>
  );
};

const MeetingListPage = () => {
  const { t } = useTranslation('meeting');
  const { error } = meetingActions.useFetchMeetings();
  const meetings = useMeetingStore(meetingSelectors.meetingList);

  const record = (
    <Button
      icon={AudioLinesIcon}
      size={'small'}
      type={'primary'}
      onClick={meetingActions.openRecorder}
    >
      {t('entry.record')}
    </Button>
  );

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader left={<Text weight={600}>{t('list.title')}</Text>} right={record} />
      <WideScreenContainer
        fullWidth
        flex={1}
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        {meetings === undefined ? (
          error ? (
            <Block padding={32} variant={'outlined'}>
              <Flexbox align={'center'} gap={12}>
                <Text weight={600}>{t('list.loadError.title')}</Text>
                <Text fontSize={13} type={'secondary'}>
                  {t('list.loadError.description')}
                </Text>
                <Button icon={RefreshCwIcon} onClick={() => void meetingActions.refreshMeetings()}>
                  {t('list.retry')}
                </Button>
              </Flexbox>
            </Block>
          ) : (
            <ListSkeleton chrome={'body'} />
          )
        ) : meetings.length === 0 ? (
          <Flexbox align={'center'} gap={16} paddingBlock={64}>
            <Empty
              description={t('list.empty.description')}
              icon={AudioLinesIcon}
              title={t('list.empty.title')}
            />
            <Button icon={AudioLinesIcon} type={'primary'} onClick={meetingActions.openRecorder}>
              {t('list.empty.action')}
            </Button>
          </Flexbox>
        ) : (
          <Flexbox gap={10}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={16} weight={600}>
                {t('list.title')}
              </Text>
              <span className={stylex.props(styles.count).className}>{meetings.length}</span>
            </Flexbox>
            <div className={stylex.props(styles.rows).className}>
              {meetings.map((meeting) => (
                <MeetingRow key={meeting.id} meeting={meeting} />
              ))}
            </div>
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
};

export default MeetingListPage;
