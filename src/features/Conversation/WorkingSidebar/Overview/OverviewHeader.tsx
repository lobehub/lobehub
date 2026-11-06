import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderGit2Icon, FolderIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  dot: {
    flexShrink: 0,
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
  header: {
    cursor: 'pointer',
    flexShrink: 0,
    paddingBlockStart: '14px',
    paddingBlockEnd: '2px',
    paddingInlineStart: '16px',
    paddingInlineEnd: '14px',
  },
  identity: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '1px',
    minWidth: '0',
  },
  name: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '18px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tile: {
    display: 'grid',
    flexShrink: 0,
    placeItems: 'center',
    width: '32px',
    height: '32px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '9px',
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
        gap={10}
        role={'button'}
        title={path}
        onClick={onClick}
      >
        <span {...stylex.props(styles.tile)}>
          {repoType === 'github' ? (
            <Github size={18} />
          ) : (
            <Icon icon={repoType ? FolderGit2Icon : FolderIcon} size={18} />
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
      </Flexbox>
    );
  },
);

OverviewHeader.displayName = 'OverviewHeader';

export default OverviewHeader;
