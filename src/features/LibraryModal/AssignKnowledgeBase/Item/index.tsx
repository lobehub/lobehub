import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import KnowledgeIcon from '@/components/KnowledgeIcon';
import { type KnowledgeItem } from '@/types/knowledgeBase';

import Actions from './Action';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    margin: 0 !important;
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextDescription};
  `,
  link: css`
    overflow: hidden;
    color: ${cssVar.colorText};
  `,
  title: css`
    margin: 0 !important;
    font-size: 14px;
    line-height: 1;
  `,
}));

const PluginItem = memo<KnowledgeItem>(({ id, fileType, name, type, description, enabled }) => {
  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      justify={'space-between'}
      paddingBlock={12}
      paddingInline={16}
      style={{ position: 'relative' }}
    >
      <Flexbox
        horizontal
        align={'center'}
        flex={1}
        gap={8}
        style={{ overflow: 'hidden', position: 'relative' }}
      >
        <KnowledgeIcon fileType={fileType} name={name} size={{ file: 40, repo: 40 }} type={type} />
        <Flexbox flex={1} gap={4} style={{ overflow: 'hidden', position: 'relative' }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text ellipsis className={styles.title}>
              {name}
            </Text>
          </Flexbox>
          {description && (
            <Text ellipsis className={styles.desc}>
              {description}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
      <Actions enabled={enabled} id={id} type={type} />
    </Flexbox>
  );
});

export default PluginItem;
