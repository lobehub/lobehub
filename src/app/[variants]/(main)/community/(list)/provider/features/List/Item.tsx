import { Github, ModelTag, ProviderCombine } from '@lobehub/icons';
import { ActionIcon, Block, Flexbox, MaskShadow, Text, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GlobeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { type DiscoverProviderItem } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      color: ${cssVar.colorTextDescription};
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
    desc: css`
      flex: none;
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

const ProviderItem = memo<DiscoverProviderItem>(
  ({ url, name, description, identifier, models }) => {
    const navigate = useNavigate();
    const link = urlJoin('/community/provider', identifier);
    const { t } = useTranslation(['discover', 'providers']);

    return (
      <Block
        clickable
        data-testid="provider-item"
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
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <ProviderCombine provider={identifier} size={28} style={{ flex: 'none' }} />
            </Link>
            <div className={styles.author}>@{name}</div>
          </Flexbox>
          <Flexbox horizontal align={'center'}>
            <a href={url} rel="noopener noreferrer" target={'_blank'} onClick={stopPropagation}>
              <ActionIcon color={cssVar.colorTextDescription} icon={GlobeIcon} />
            </a>
            <a
              href={`https://github.com/lobehub/lobe-chat/blob/main/src/config/modelProviders/${identifier}.ts`}
              rel="noopener noreferrer"
              target={'_blank'}
              onClick={stopPropagation}
            >
              <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
            </a>
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          {description && (
            <Text
              className={styles.desc}
              ellipsis={{
                rows: 3,
              }}
            >
              {t(`${identifier}.description`, { ns: 'providers' })}
            </Text>
          )}
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <MaskShadow horizontal gap={6} position={'right'} size={10} width={'100%'}>
            {models
              .slice(0, 6)
              .filter(Boolean)
              .map((tag: string) => (
                <Link key={tag} to={urlJoin('/model', tag)}>
                  <ModelTag model={tag} style={{ margin: 0 }} />
                </Link>
              ))}
          </MaskShadow>
        </Flexbox>
      </Block>
    );
  },
);

export default ProviderItem;
