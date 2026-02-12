import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import KnowledgeIcon from '@/components/KnowledgeIcon';
import { type KnowledgeItem } from '@/types/knowledgeBase';

import Actions from './Action';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: all ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  desc: css`
    margin: 0 !important;
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    margin: 0 !important;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
  `,
}));

const MasonryItem = memo<KnowledgeItem>(({ id, fileType, name, type, description, enabled }) => {
  return (
    <div className={styles.card}>
      <Flexbox gap={12} style={{ position: 'relative' }}>
        <Flexbox horizontal align={'center'} gap={12}>
          <KnowledgeIcon
            fileType={fileType}
            name={name}
            size={{ file: 48, repo: 48 }}
            type={type}
          />
          <Flexbox flex={1} gap={6} style={{ overflow: 'hidden', position: 'relative' }}>
            <Text className={styles.title} ellipsis={{ rows: 2 }}>
              {name}
            </Text>
          </Flexbox>
        </Flexbox>
        {description && (
          <Text className={styles.desc} ellipsis={{ rows: 3 }}>
            {description}
          </Text>
        )}
        <Flexbox align={'center'} justify={'flex-end'}>
          <Actions enabled={enabled} id={id} type={type} />
        </Flexbox>
      </Flexbox>
    </div>
  );
});

MasonryItem.displayName = 'MasonryItem';

export default MasonryItem;
