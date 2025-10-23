'use client';

import { ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Block, Icon, Tag, Text } from '@lobehub/ui';
import { Popover } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelInfoTags } from '@/components/ModelSelect';
import { DiscoverModelItem } from '@/types/discover';

import PublishedTime from '../../../../../../../../components/PublishedTime';
import ModelTypeIcon from './ModelTypeIcon';

const useStyles = createStyles(({ css, token }) => {
  return {
    author: css`
      color: ${token.colorTextDescription};
    `,
    code: css`
      font-family: ${token.fontFamilyCode};
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${token.colorTextSecondary};
    `,
    footer: css`
      margin-block-start: 16px;
      border-block-start: 1px dashed ${token.colorBorder};
      background: ${token.colorBgContainerSecondary};
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${token.colorTextDescription};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${token.colorLink};
      }
    `,
  };
});

const ModelItem = memo<DiscoverModelItem>(
  ({ identifier, displayName, contextWindowTokens, releasedAt, type, abilities, providers }) => {
    const { t } = useTranslation(['models', 'discover']);
    const { styles } = useStyles();
    const navigate = useNavigate();
    const link = urlJoin('/model', identifier);
    return (
      <Block
        clickable
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
              arrow={false}
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
