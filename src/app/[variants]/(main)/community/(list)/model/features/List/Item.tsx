'use client';

import { ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Block, Flexbox, Icon, Popover, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelInfoTags } from '@/components/ModelSelect';
import { type DiscoverModelItem } from '@/types/discover';

import PublishedTime from '../../../../../../../../components/PublishedTime';
import ModelTypeIcon from './ModelTypeIcon';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      color: ${cssVar.colorTextDescription};
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
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
  };
});

const ModelItem = memo<DiscoverModelItem>(
  ({ identifier, displayName, contextWindowTokens, releasedAt, type, abilities, providers }) => {
    const { t } = useTranslation(['models', 'discover']);
    const navigate = useNavigate();
    const link = urlJoin('/community/model', identifier);
    return (
      <Block
        clickable
        data-testid="model-item"
        height={'100%'}
        onClick={() => {
          navigate(link);
        }}
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
            <ModelIcon model={identifier} size={40} style={{ flex: 'none' }} type={'avatar'} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                align={'center'}
                flex={1}
                gap={8}
                horizontal
                style={{
                  overflow: 'hidden',
                }}
              >
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text as={'h2'} className={styles.title} ellipsis>
                    {displayName}
                  </Text>
                </Link>
              </Flexbox>
              <div className={styles.author}>{identifier}</div>
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal>
            <ModelTypeIcon type={type} />
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <ModelInfoTags
            contextWindowTokens={contextWindowTokens}
            directionReverse
            {...abilities}
          />
          <Text
            as={'p'}
            className={styles.desc}
            ellipsis={{
              rows: 3,
            }}
          >
            {t(`${identifier}.description`)}
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
                date={releasedAt || dayjs().toISOString()}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            <Popover
              content={
                <Flexbox
                  gap={6}
                  horizontal
                  style={{
                    maxWidth: 175,
                  }}
                  wrap={'wrap'}
                >
                  {providers.map((item) => (
                    <ProviderIcon key={item} provider={item} size={24} />
                  ))}
                </Flexbox>
              }
            >
              <Flexbox align={'center'} gap={6} horizontal>
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
