'use client';

import { Avatar, Block, Flexbox, Grid, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';

import PublishedTime from '@/components/PublishedTime';
import { type DiscoverAssistantItem } from '@/types/discover';

import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`
    color: ${cssVar.colorTextDescription};
  `,
  desc: css`
    flex: 1;
    margin: 0 !important;
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    margin-block-start: 16px;
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  secondaryDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    margin: 0 !important;
    font-size: 16px !important;
    font-weight: 500 !important;

    &:hover {
      color: ${cssVar.colorLink};
    }
  `,
}));

const AgentItem = memo<DiscoverAssistantItem>(
  ({ createdAt, author, avatar, title, description, identifier, category, backgroundColor }) => {
    return (
      <a
        href={`/community/agent/${identifier}`}
        rel="noopener noreferrer"
        style={{ display: 'block', height: '100%' }}
        target="_blank"
      >
        <Block
          clickable
          height={'100%'}
          style={{
            overflow: 'hidden',
            position: 'relative',
          }}
          variant={'outlined'}
          width={'100%'}
        >
          <Flexbox
            align={'flex-start'}
            gap={16}
            horizontal
            justify={'space-between'}
            padding={16}
            width={'100%'}
          >
            <Flexbox
              gap={12}
              horizontal
              style={{
                overflow: 'hidden',
              }}
              title={identifier}
            >
              <Avatar
                avatar={avatar}
                background={backgroundColor || 'transparent'}
                shape={'square'}
                size={40}
                style={{ flex: 'none' }}
              />
              <Flexbox
                flex={1}
                gap={2}
                style={{
                  overflow: 'hidden',
                }}
              >
                <Text as={'h2'} className={styles.title} ellipsis>
                  {title}
                </Text>
                {author && <div className={styles.author}>{author}</div>}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox flex={1} gap={12} paddingInline={16}>
            <Text
              as={'p'}
              className={styles.desc}
              ellipsis={{
                rows: 3,
              }}
            >
              {description}
            </Text>
          </Flexbox>
          <Flexbox
            align={'center'}
            className={styles.footer}
            horizontal
            justify={'space-between'}
            padding={16}
          >
            <Flexbox
              align={'center'}
              className={styles.secondaryDesc}
              horizontal
              justify={'space-between'}
            >
              <Flexbox align={'center'} gap={4} horizontal>
                <Icon icon={ClockIcon} size={14} />
                <PublishedTime
                  className={styles.secondaryDesc}
                  date={createdAt}
                  template={'MMM DD, YYYY'}
                />
              </Flexbox>
              {category && <span style={{ marginLeft: 12 }}>{category}</span>}
            </Flexbox>
          </Flexbox>
        </Block>
      </a>
    );
  },
);

const Agents = memo(() => {
  const { agents = [] } = useDetailContext();

  return (
    <Grid gap={16} rows={2} width={'100%'}>
      {agents.map((agent) => (
        <AgentItem key={agent.identifier} {...agent} />
      ))}
    </Grid>
  );
});

export default Agents;
