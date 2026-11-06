import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import KnowledgeIcon from '@/components/KnowledgeIcon';
import { type KnowledgeItem } from '@/types/knowledgeBase';

import Actions from './Action';

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorPrimary },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: { 'default': null, ':hover': cssVar.boxShadowTertiary },
    transition: `all ${cssVar.motionDurationMid}`,
  },
  desc: {
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextDescription,
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
  },
});

interface MasonryItemProps extends KnowledgeItem {
  action?: ReactNode;
}

const MasonryItem = memo<MasonryItemProps>(
  ({ action, id, fileType, name, type, description, enabled, memberRestricted, visibility }) => {
    return (
      <div {...stylex.props(styles.card)}>
        <Flexbox gap={12} style={{ position: 'relative' }}>
          <Flexbox horizontal align={'center'} gap={12}>
            <KnowledgeIcon
              fileType={fileType}
              locked={memberRestricted}
              name={name}
              size={{ file: 48, repo: 48 }}
              type={type}
            />
            <Flexbox flex={1} gap={6} style={{ overflow: 'hidden', position: 'relative' }}>
              <Flexbox horizontal align={'center'} gap={6}>
                {visibility === 'private' && (
                  <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={12} />
                )}
                <Text className={stylex.props(styles.title).className} ellipsis={{ rows: 2 }}>
                  {name}
                </Text>
              </Flexbox>
            </Flexbox>
          </Flexbox>
          {description && (
            <Text className={stylex.props(styles.desc).className} ellipsis={{ rows: 3 }}>
              {description}
            </Text>
          )}
          <Flexbox align={'center'} justify={'flex-end'}>
            {action === undefined ? <Actions enabled={enabled} id={id} type={type} /> : action}
          </Flexbox>
        </Flexbox>
      </div>
    );
  },
);

MasonryItem.displayName = 'MasonryItem';

export default MasonryItem;
