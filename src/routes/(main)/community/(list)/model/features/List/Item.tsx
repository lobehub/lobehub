'use client';

import { Block, Flexbox, Icon, Popover, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { ModelIcon, ProviderIcon } from '@/components/LobeIcons';
import { ModelInfoTags } from '@/components/ModelSelect';
import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { type DiscoverModelItem } from '@/types/discover';

import ModelTypeIcon from './ModelTypeIcon';

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

const ModelItem = memo<DiscoverModelItem>(
  ({
    description,
    identifier,
    displayName,
    contextWindowTokens,
    releasedAt,
    type,
    abilities,
    providers,
  }) => {
    const { t } = useTranslation(['models', 'discover']);
    const navigate = useWorkspaceAwareNavigate();
    const link = urlJoin('/community/model', identifier);
    return (
      <Block
        clickable
        data-testid="model-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={() => {
          navigate(link);
        }}
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
            <ModelIcon model={identifier} size={40} style={{ flex: 'none' }} type={'avatar'} />
            <Flexbox
              flex={1}
              gap={2}
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
                    {displayName}
                  </Text>
                </WorkspaceLink>
              </Flexbox>
              <div className={stylex.props(styles.author).className}>{identifier}</div>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <ModelTypeIcon type={type} />
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <ModelInfoTags
            directionReverse
            contextWindowTokens={contextWindowTokens}
            {...abilities}
          />
          <Text
            as={'p'}
            className={stylex.props(styles.desc).className}
            ellipsis={{
              rows: 3,
            }}
          >
            {t(`${identifier}.description`, { defaultValue: description })}
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
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={stylex.props(styles.secondaryDesc).className}
                date={releasedAt || dayjs().toISOString()}
              />
            </Flexbox>
            <Popover
              content={
                <Flexbox
                  horizontal
                  gap={6}
                  wrap={'wrap'}
                  style={{
                    maxWidth: 175,
                  }}
                >
                  {providers.map((item) => (
                    <ProviderIcon key={item} provider={item} size={24} />
                  ))}
                </Flexbox>
              }
            >
              <Flexbox horizontal align={'center'} gap={6}>
                {providers.slice(0, 6).map((item) => (
                  <ProviderIcon key={item} provider={item} size={14} type={'mono'} />
                ))}
                {providers.length > 6 && <Tag size={'small'}>{providers.length}</Tag>}
              </Flexbox>
            </Popover>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default ModelItem;
