'use client';

import { Avatar, type AvatarGroupItemType, Flexbox, Icon, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LocateFixedIcon, SparklesIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { type PresencePeer } from '../collab/presence';
import { usePagePresence } from '../collab/usePagePresence';
import { usePageEditorStore } from '../store';

const AGENT_KEY = 'agent';
const AGENT_RING = '#8b5cf6';
const MAX_VISIBLE = 3;
const AVATAR_SIZE = 24;

const agentPulse = stylex.keyframes({
  '0%, 100%': { boxShadow: `0 0 0 2px ${AGENT_RING}` },
  '50%': { boxShadow: `0 0 0 2px color-mix(in srgb, ${AGENT_RING} 30%, transparent)` },
});

const styles = stylex.create({
  agentAvatar: {
    animationDuration: {
      'default': '1.6s',
      '@media (prefers-reduced-motion: reduce)': '0s',
    },
    animationIterationCount: 'infinite',
    animationName: agentPulse,
    animationTimingFunction: 'ease-in-out',
  },
  away: {
    filter: 'grayscale(1)',
    opacity: 0.45,
  },
  list: {
    minWidth: 260,
    paddingBlock: 4,
  },
  listHeader: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 4,
    paddingInline: 8,
  },
  offline: {
    filter: 'grayscale(1)',
    opacity: 0.4,
  },
  row: {
    alignItems: 'center',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
    borderRadius: 6,
    borderStyle: 'none',
    color: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    gap: 10,
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'start',
    width: '100%',
  },
  rowStatic: {
    cursor: 'default',
  },
  rowWho: {
    flex: '1',
    minWidth: 0,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderStyle: 'none',
    cursor: 'pointer',
    display: 'flex',
    paddingBlock: 2,
    paddingInline: 4,
  },
});

const ringStyle = (color: string) => ({
  boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}, 0 0 0 3.5px ${color}`,
});

const AgentAvatar = ({ size }: { size: number }) => (
  <Avatar
    avatar={<Icon icon={SparklesIcon} size={size * 0.5} />}
    background={cssVar.colorText}
    shape={'circle'}
    size={size}
    {...stylex.props(styles.agentAvatar)}
  />
);

interface RowProps {
  avatar: ReactNode;
  name: string;
  onClick?: () => void;
  status: string;
}

const Row = ({ avatar, name, onClick, status }: RowProps) => {
  const content = (
    <>
      {avatar}
      <div {...stylex.props(styles.rowWho)}>
        <Text ellipsis weight={500}>
          {name}
        </Text>
        <Text ellipsis fontSize={12} type={'secondary'}>
          {status}
        </Text>
      </div>
      {onClick && (
        <Icon icon={LocateFixedIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
      )}
    </>
  );

  if (!onClick) return <div {...stylex.props(styles.row, styles.rowStatic)}>{content}</div>;
  return (
    <button type={'button'} onClick={onClick} {...stylex.props(styles.row)}>
      {content}
    </button>
  );
};

const PresenceStack = () => {
  const { t } = useTranslation('file');
  const [open, setOpen] = useState(false);
  const { peers, getSection, hasCursor, jumpTo } = usePagePresence();
  const collabStatus = usePageEditorStore((s) => s.collab?.status);
  const offline = collabStatus === 'offline';
  const documentId = usePageEditorStore((s) => s.documentId);
  const agentEditing = useDocumentStore((s) =>
    documentId ? editorSelectors.isAgentEditing(documentId)(s) : false,
  );

  if (!collabStatus || (peers.length === 0 && !agentEditing)) return null;

  const items: AvatarGroupItemType[] = [
    ...(agentEditing
      ? [
          {
            avatar: <Icon icon={SparklesIcon} size={AVATAR_SIZE * 0.5} />,
            className: stylex.props(styles.agentAvatar).className,
            key: AGENT_KEY,
            title: t('pageEditor.collab.presence.agent'),
          },
        ]
      : []),
    ...peers.map((peer) => ({
      avatar: peer.avatar || peer.name,
      className: peer.away ? stylex.props(styles.away).className : undefined,
      key: String(peer.clientId),
      ringColor: peer.away ? undefined : peer.color,
      title: peer.name,
    })),
  ];

  const peerStatus = (peer: PresencePeer) => {
    if (peer.away) return t('pageEditor.collab.presence.away');
    const section = getSection(peer.clientId);
    return section
      ? t('pageEditor.collab.presence.inSection', { section })
      : t('pageEditor.collab.presence.onPage');
  };

  const content = (
    <Flexbox {...stylex.props(styles.list)}>
      <Flexbox horizontal justify={'space-between'} {...stylex.props(styles.listHeader)}>
        <span>{t('pageEditor.collab.presence.title')}</span>
        <span>{t('pageEditor.collab.presence.jumpHint')}</span>
      </Flexbox>
      {agentEditing && (
        <Row
          avatar={<AgentAvatar size={AVATAR_SIZE} />}
          name={t('pageEditor.collab.presence.agent')}
          status={t('pageEditor.collab.presence.agentStatus')}
        />
      )}
      {peers.map((peer) => (
        <Row
          key={peer.clientId}
          name={peer.name}
          status={peerStatus(peer)}
          avatar={
            <Avatar
              avatar={peer.avatar || peer.name}
              shape={'circle'}
              size={AVATAR_SIZE}
              style={peer.away ? undefined : ringStyle(peer.color)}
              title={peer.name}
              {...(peer.away ? stylex.props(styles.away) : {})}
            />
          }
          onClick={
            !peer.away && hasCursor(peer.clientId)
              ? () => {
                  setOpen(false);
                  jumpTo(peer);
                }
              : undefined
          }
        />
      ))}
    </Flexbox>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement={'bottomRight'}
      trigger={'click'}
      onOpenChange={setOpen}
    >
      <button
        aria-expanded={open}
        aria-label={t('pageEditor.collab.presence.trigger')}
        type={'button'}
        {...stylex.props(styles.trigger, offline && styles.offline)}
      >
        <Avatar.Group items={items} max={MAX_VISIBLE} shape={'circle'} size={AVATAR_SIZE} />
      </button>
    </Popover>
  );
};

export default PresenceStack;
