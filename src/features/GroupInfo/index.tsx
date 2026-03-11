import { Avatar, Center, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { startCase } from 'es-toolkit/compat';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { type MetaData } from '@/types/meta';

const styles = createStaticStyles(({ css }) => ({
  avatar: css`
    flex: none;
  `,
  desc: css`
    color: ${cssVar.colorTextDescription};
    text-align: center;
  `,
  title: css`
    font-size: 20px;
    font-weight: 600;
    text-align: center;
  `,
}));

export interface GroupInfoProps {
  meta?: MetaData;
  onAvatarClick?: () => void;
  style?: CSSProperties;
}

const GroupInfo = memo<GroupInfoProps>(({ style, meta, onAvatarClick }) => {
  if (!meta) return;

  return (
    <Center gap={16} style={style}>
      <Avatar
        animation
        avatar="👥"
        background={cssVar.colorFillTertiary}
        className={styles.avatar}
        shape={'square'}
        size={100}
        onClick={onAvatarClick}
      />
      {meta.title && <div className={styles.title}>{meta.title}</div>}
      {(meta?.tags as string[])?.length > 0 && (
        <Center horizontal gap={6} style={{ flexWrap: 'wrap' }}>
          {(meta.tags as string[]).map((tag: string, index) => (
            <Tag key={index} style={{ margin: 0 }}>
              {startCase(tag).trim()}
            </Tag>
          ))}
        </Center>
      )}
      {meta.description && <div className={styles.desc}>{meta.description}</div>}
    </Center>
  );
});

export default GroupInfo;
