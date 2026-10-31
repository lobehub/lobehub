import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import KnowledgeIcon from '@/components/KnowledgeIcon';
import { type KnowledgeItem } from '@/types/knowledgeBase';

import Actions from './Action';

const styles = stylex.create({
  desc: {
    margin: 0,
    fontSize: '12px',
    lineHeight: 1,
    color: cssVar.colorTextDescription,
  },
  title: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1,
  },
});

interface PluginItemProps extends KnowledgeItem {
  action?: ReactNode;
}

const PluginItem = memo<PluginItemProps>(
  ({ action, id, fileType, name, type, description, enabled, memberRestricted, visibility }) => {
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
          <KnowledgeIcon
            fileType={fileType}
            locked={memberRestricted}
            name={name}
            size={{ file: 40, repo: 40 }}
            type={type}
          />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden', position: 'relative' }}>
            <Flexbox horizontal align={'center'} gap={6}>
              {visibility === 'private' && (
                <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={12} />
              )}
              <Text ellipsis className={stylex.props(styles.title).className}>
                {name}
              </Text>
            </Flexbox>
            {description && (
              <Text ellipsis className={stylex.props(styles.desc).className}>
                {description}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        {action === undefined ? <Actions enabled={enabled} id={id} type={type} /> : action}
      </Flexbox>
    );
  },
);

export default PluginItem;
