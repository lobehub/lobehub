import { Avatar, Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';

import { useMentionStore } from '@/store/mention';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;

    width: 180px;
    height: 64px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    :hover {
      background: ${cssVar.colorBgElevated};
    }
  `,
  removeButton: css`
    cursor: pointer;

    position: absolute;
    z-index: 10;
    inset-block-start: -4px;
    inset-inline-end: -4px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 5px;

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 0 0 0.5px ${cssVar.colorFillSecondary} inset,
      ${cssVar.boxShadowTertiary};

    :hover {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }
  `,
}));

interface MentionedUserItemProps {
  agent: any; // The actual agent data from the group
}

const MentionedUserItem = memo<MentionedUserItemProps>(({ agent }) => {
  const removeMentionedUser = useMentionStore((s) => s.removeMentionedUser);

  const handleRemove = () => {
    removeMentionedUser(agent.id);
  };

  return (
    <Flexbox horizontal align={'center'} className={styles.container}>
      <Center flex={1} height={64} padding={4} style={{ maxWidth: 64 }}>
        <Avatar
          avatar={agent.avatar}
          background={agent.backgroundColor}
          shape={'square'}
          size={48}
        />
      </Center>
      <Flexbox flex={1} gap={4} style={{ paddingBottom: 4, paddingInline: 4 }}>
        <Text ellipsis={{ tooltip: true }} style={{ fontSize: 12, maxWidth: 100 }}>
          {agent.title || agent.id}
        </Text>
        <Text style={{ fontSize: 10 }} type="secondary">
          @{agent.id}
        </Text>
      </Flexbox>
      <div className={styles.removeButton} onClick={handleRemove}>
        <X size={12} />
      </div>
    </Flexbox>
  );
});

export default MentionedUserItem;
