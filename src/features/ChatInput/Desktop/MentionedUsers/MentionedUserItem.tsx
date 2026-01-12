import { Avatar, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { useMentionStore } from '@/store/mention';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: relative;

    width: 180px;
    height: 64px;
    border-radius: 8px;

    background: ${token.colorBgContainer};

    :hover {
      background: ${token.colorBgElevated};
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

    background: ${token.colorBgElevated};
    box-shadow:
      0 0 0 0.5px ${token.colorFillSecondary} inset,
      ${token.boxShadowTertiary};

    :hover {
      color: ${token.colorError};
      background: ${token.colorErrorBg};
    }
  `,
}));

interface MentionedUserItemProps {
  agent: {
    avatar?: string;
    backgroundColor?: string;
    id: string;
    title?: string;
  };
}

const MentionedUserItem = memo<MentionedUserItemProps>(({ agent }) => {
  const { styles } = useStyles();
  const removeMentionedUser = useMentionStore((s) => s.removeMentionedUser);

  const handleRemove = () => {
    removeMentionedUser(agent.id);
  };

  return (
    <Flexbox align={'center'} className={styles.container} horizontal>
      <Center flex={1} height={64} padding={4} style={{ maxWidth: 64 }}>
        <Avatar avatar={agent.avatar} background={agent.backgroundColor} shape="circle" size={48} />
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
