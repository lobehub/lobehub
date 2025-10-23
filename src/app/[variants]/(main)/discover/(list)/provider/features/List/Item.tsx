import { Github, ModelTag, ProviderCombine } from '@lobehub/icons';
import { ActionIcon, Block, MaskShadow, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { GlobeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { DiscoverProviderItem } from '@/types/discover';

const useStyles = createStyles(({ css, token }) => {
  return {
    author: css`
      color: ${token.colorTextDescription};
    `,
    code: css`
      font-family: ${token.fontFamilyCode};
    `,
    desc: css`
      flex: none;
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

const ProviderItem = memo<DiscoverProviderItem>(
  ({ url, name, description, identifier, models }) => {
    const { styles, theme } = useStyles();
    const navigate = useNavigate();
    const link = urlJoin('/provider', identifier);
    const { t } = useTranslation(['discover', 'providers']);

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
            style={{
              overflow: 'hidden',
            }}
            title={identifier}
          >
            <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <ProviderCombine provider={identifier} size={28} style={{ flex: 'none' }} />
            </Link>
            <div className={styles.author}>@{name}</div>
          </Flexbox>
          <Flexbox align={'center'} horizontal>
            <a
              href={url}
              onClick={(e) => e.stopPropagation()}
              rel="noopener noreferrer"
              target={'_blank'}
            >
              <ActionIcon color={theme.colorTextDescription} icon={GlobeIcon} />
            </a>
            <a
              href={`https://github.com/lobehub/lobe-chat/blob/main/src/config/modelProviders/${identifier}.ts`}
              onClick={(e) => e.stopPropagation()}
              rel="noopener noreferrer"
              target={'_blank'}
            >
              <ActionIcon fill={theme.colorTextDescription} icon={Github} />
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
          align={'center'}
          className={styles.footer}
          horizontal
          justify={'space-between'}
          padding={16}
        >
          <MaskShadow gap={6} horizontal position={'right'} size={10} width={'100%'}>
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
