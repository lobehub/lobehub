import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, FolderGit2Icon, FolderIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sidebarRow } from '@/styles/density.stylex';

const styles = stylex.create({
  dot: {
    flexShrink: 0,
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
  chevron: {
    display: 'grid',
    flexShrink: 0,
    placeItems: 'center',
    width: sidebarRow.iconBox,
    height: sidebarRow.iconBox,
    color: cssVar.colorTextTertiary,
  },
  header: {
    cursor: 'pointer',
    flexShrink: 0,
    gap: sidebarRow.gap,
    minHeight: '40px',
    marginBlockStart: '4px',
    marginBlockEnd: '8px',
    paddingBlock: '6px',
    paddingInline: '6px',
    borderRadius: sidebarRow.radius,
    transition: 'background-color 0.12s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  identity: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: '0',
  },
  name: {
    overflow: 'hidden',
    fontSize: sidebarRow.textFontSize,
    fontWeight: 600,
    lineHeight: sidebarRow.textLineHeight,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tile: {
    display: 'grid',
    flexShrink: 0,
    placeItems: 'center',
    width: '28px',
    height: '28px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface OverviewHeaderProps {
  deviceId?: string;
  error?: boolean;
  name: string;
  onClick?: () => void;
  path: string;
  repoType?: string;
}

const OverviewHeader = memo<OverviewHeaderProps>(
  ({ deviceId, error, name, onClick, path, repoType }) => {
    const { t } = useTranslation('chat');
    const dotColor = error ? cssVar.colorError : deviceId ? cssVar.colorInfo : undefined;

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        role={'button'}
        title={path}
        onClick={onClick}
      >
        <span {...stylex.props(styles.tile)}>
          {repoType === 'github' ? (
            <Github size={16} />
          ) : (
            <Icon icon={repoType ? FolderGit2Icon : FolderIcon} size={16} />
          )}
        </span>
        <span {...stylex.props(styles.identity)}>
          <span {...stylex.props(styles.name)}>{name}</span>
          <span {...stylex.props(styles.sub)}>
            <i
              className={stylex.props(styles.dot).className}
              style={dotColor ? { background: dotColor } : undefined}
            />
            <span {...stylex.props(styles.subText)}>
              {t(
                deviceId
                  ? 'workingPanel.overview.execution.device'
                  : 'workingPanel.overview.execution.local',
              )}
              {' · '}
              {path}
            </span>
          </span>
        </span>
        <span {...stylex.props(styles.chevron)}>
          <Icon icon={ChevronRightIcon} size={14} />
        </span>
      </Flexbox>
    );
  },
);

OverviewHeader.displayName = 'OverviewHeader';

export default OverviewHeader;
