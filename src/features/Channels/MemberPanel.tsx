import type { ChannelDetail } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';

import { MemberList, useMemberEntries } from './MemberList';
import { styles } from './styles';

export const MEMBER_PANEL_WIDTH = 256;
export const MEMBER_FLOAT_BREAKPOINT = 640;

const panelStyles = stylex.create({
  panel: {
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

/** Workspace roster: a single list, without online/offline groups. */
export function MemberPanel({
  availableWidth = 1000,
  detail,
  id,
  onClose,
}: {
  availableWidth?: number;
  detail: ChannelDetail;
  id: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('channel');
  const entries = useMemberEntries(detail);
  const narrow = availableWidth < MEMBER_FLOAT_BREAKPOINT;
  const width = narrow ? availableWidth : MEMBER_PANEL_WIDTH;

  return (
    <RightPanel
      expand
      expandFollowsSelection
      className={stylex.props(styles.threadPanel).className}
      classNames={{ content: stylex.props(styles.threadContent).className }}
      maxWidth={width}
      minWidth={width}
      mode={narrow ? 'float' : 'fixed'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      width={width}
      onExpandChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Flexbox
        aria-label={t('membersTitle')}
        id={id}
        role="complementary"
        {...stylex.props(styles.body, panelStyles.panel)}
      >
        <NavHeader
          paddingBlock={6}
          paddingInline={12}
          showTogglePanelButton={false}
          left={
            <Text fontSize={12} type="secondary" weight={500}>
              {t('membersCount', { count: entries.length })}
            </Text>
          }
          right={
            <ActionIcon
              aria-label={t('members.hide')}
              icon={X}
              size="small"
              title={t('members.hide')}
              onClick={onClose}
            />
          }
        />
        <Flexbox flex={1} padding={12} paddingBlock={4} style={{ minHeight: 0, overflowY: 'auto' }}>
          <MemberList detail={detail} />
        </Flexbox>
      </Flexbox>
    </RightPanel>
  );
}
