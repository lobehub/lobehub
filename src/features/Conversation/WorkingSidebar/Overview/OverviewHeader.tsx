import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { FolderGit2Icon, FolderIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dot: css`
    flex-shrink: 0;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,
  header: css`
    cursor: pointer;
    flex-shrink: 0;
    padding-block: 14px 2px;
    padding-inline: 16px 14px;
  `,
  identity: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  name: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 600;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sub: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  subText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tile: css`
    display: grid;
    flex-shrink: 0;
    place-items: center;

    width: 32px;
    height: 32px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 9px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
}));

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
        className={styles.header}
        gap={10}
        role={'button'}
        title={path}
        onClick={onClick}
      >
        <span className={styles.tile}>
          {repoType === 'github' ? (
            <Github size={18} />
          ) : (
            <Icon icon={repoType ? FolderGit2Icon : FolderIcon} size={18} />
          )}
        </span>
        <span className={styles.identity}>
          <span className={styles.name}>{name}</span>
          <span className={styles.sub}>
            <i className={cx(styles.dot)} style={dotColor ? { background: dotColor } : undefined} />
            <span className={styles.subText}>
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
