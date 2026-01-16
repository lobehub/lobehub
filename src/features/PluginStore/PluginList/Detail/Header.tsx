'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Collapse, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { DotIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';

import { useDetailContext } from './DetailProvider';
import TagList from './TagList';

const styles = createStaticStyles(({ css }) => {
  return {
    desc: css`
      color: ${cssVar.colorTextSecondary};
    `,
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    version: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 13px;
    `,
  };
});

const Header = memo<{ inModal?: boolean; mobile?: boolean }>(({ mobile: isMobile, inModal }) => {
  const { author, identifier, createdAt, avatar, title, tags, description } = useDetailContext();
  const { mobile = isMobile } = useResponsive();
  const { t } = useTranslation('discover');

  return (
    <Flexbox gap={24}>
      <Flexbox align={'flex-start'} gap={16} horizontal width={'100%'}>
        <Avatar avatar={avatar} shape={'square'} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Flexbox
              align={'center'}
              flex={1}
              gap={12}
              horizontal
              style={{
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Text
                as={'h1'}
                ellipsis
                style={{ fontSize: inModal ? 20 : mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {title}
              </Text>
            </Flexbox>
            {identifier && (
              <Flexbox align={'center'} gap={6} horizontal>
                <a
                  href={urlJoin(
                    'https://github.com/lobehub/lobe-chat-agents/tree/main/locales',
                    identifier,
                  )}
                  onClick={(e) => e.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
                </a>
              </Flexbox>
            )}
          </Flexbox>
          <Flexbox horizontal justify={'space-between'}>
            <Flexbox>
              <Flexbox align={'center'} gap={4} horizontal>
                {author && (
                  <a href={urlJoin('https://github.com', author)} rel="noreferrer" target="_blank">
                    {author}
                  </a>
                )}
                <Icon icon={DotIcon} />
                <PublishedTime
                  className={styles.time}
                  date={createdAt as string}
                  template={'MMM DD, YYYY'}
                />
              </Flexbox>
              {tags && <TagList tags={tags} />}
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Collapse
        defaultActiveKey={['summary']}
        expandIconPlacement={'end'}
        items={[
          {
            children: description,
            key: 'summary',
            label: t('plugins.details.summary.title'),
          },
        ]}
        variant={'outlined'}
      />
    </Flexbox>
  );
});

export default Header;
