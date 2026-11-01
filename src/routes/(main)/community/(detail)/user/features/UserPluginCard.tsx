'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { type DiscoverPluginItem } from '@/types/discover';

const styles = stylex.create({
  author: { color: cssVar.colorTextDescription },
  desc: { flex: '1', margin: '0', color: cssVar.colorTextSecondary },
  footer: {
    marginBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  secondaryDesc: { fontSize: '12px', color: cssVar.colorTextDescription },
  title: {
    margin: '0',
    fontSize: '16px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
});

type UserPluginCardProps = DiscoverPluginItem;

const UserPluginCard = memo<UserPluginCardProps>(
  ({ title, avatar, author, description, identifier, category }) => {
    const { t } = useTranslation('discover');
    const navigate = useWorkspaceAwareNavigate();
    const link = urlJoin('/community/plugin', identifier);

    const handleClick = useCallback(() => {
      navigate(link);
    }, [link, navigate]);

    return (
      <Block
        clickable
        data-testid="user-plugin-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            horizontal
            gap={12}
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <Avatar avatar={avatar || title} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={6}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={8}
                style={{
                  overflow: 'hidden',
                }}
              >
                <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
                    {title}
                  </Text>
                </WorkspaceLink>
              </Flexbox>
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.author).className}
                gap={8}
              >
                {author && <div>{author}</div>}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <Text
            as={'p'}
            className={stylex.props(styles.desc).className}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.footer).className}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.secondaryDesc).className}
            gap={8}
          >
            {category && t(`plugins.categories.${category}.name` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserPluginCard;
