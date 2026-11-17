import { Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, type LucideIcon } from 'lucide-react';

const styles = stylex.create({
  done: {
    backgroundColor: `color-mix(in srgb, ${cssVar.colorSuccess} 6%, ${cssVar.colorBgContainer})`,
    borderColor: `color-mix(in srgb, ${cssVar.colorSuccess} 35%, transparent)`,
  },
  doneStatus: {
    color: cssVar.colorSuccess,
  },
  status: {
    alignItems: 'center',
    display: 'flex',
    gap: 4,
  },
  tile: {
    alignItems: 'flex-start',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    paddingBlock: 10,
    paddingInline: 12,
    textAlign: 'start',
  },
  title: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 13,
    fontWeight: 500,
    gap: 8,
  },
  waitingDot: {
    backgroundColor: cssVar.colorWarning,
    borderRadius: '50%',
    height: 6,
    width: 6,
  },
});

interface ConnectTileProps {
  done: boolean;
  icon: LucideIcon;
  onClick: () => void;
  status: string;
  title: string;
  waiting?: boolean;
}

const ConnectTile = ({ done, icon, onClick, status, title, waiting }: ConnectTileProps) => (
  <button type="button" {...stylex.props(styles.tile, done && styles.done)} onClick={onClick}>
    <span {...stylex.props(styles.title)}>
      <Icon color={cssVar.colorTextSecondary} icon={icon} size={16} />
      {title}
    </span>
    <Text ellipsis fontSize={12} type={done ? undefined : 'secondary'}>
      <span {...stylex.props(styles.status, done && styles.doneStatus)}>
        {done ? <Icon icon={CheckIcon} size={12} /> : null}
        {waiting ? <span {...stylex.props(styles.waitingDot)} /> : null}
        {status}
      </span>
    </Text>
  </button>
);

export default ConnectTile;
