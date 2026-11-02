import { Github } from '@lobehub/icons';
import { ActionIcon, Block, Flexbox, MaskShadow, stopPropagation, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GlobeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { ModelTag, ProviderCombine } from '@/components/LobeIcons';
import { GITHUB } from '@/const/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { type DiscoverProviderItem } from '@/types/discover';

const styles = stylex.create({
  author: { color: cssVar.colorTextDescription },
  desc: { flex: 'none', margin: '0', color: cssVar.colorTextSecondary },
  footer: {
    marginBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const ProviderItem = memo<DiscoverProviderItem>(
  ({ url, name, description, identifier, models }) => {
    const navigate = useWorkspaceAwareNavigate();
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
            <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <ProviderCombine provider={identifier} size={28} style={{ flex: 'none' }} />
            </WorkspaceLink>
            <div className={stylex.props(styles.author).className}>@{name}</div>
          </Flexbox>
          <Flexbox horizontal align={'center'}>
            <a href={url} rel="noopener noreferrer" target={'_blank'} onClick={stopPropagation}>
              <ActionIcon color={cssVar.colorTextDescription} icon={GlobeIcon} />
            </a>
            <a
              href={urlJoin(GITHUB, 'blob/main/src/config/modelProviders', `${identifier}.ts`)}
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
              className={stylex.props(styles.desc).className}
              ellipsis={{
                rows: 3,
              }}
            >
              {t(`${identifier}.description`, { defaultValue: description, ns: 'providers' })}
            </Text>
          )}
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.footer).className}
          justify={'space-between'}
          padding={16}
        >
          <MaskShadow horizontal gap={6} position={'right'} size={10} width={'100%'}>
            {models
              .slice(0, 6)
              .filter(Boolean)
              .map((tag: string) => (
                <WorkspaceLink key={tag} to={urlJoin('/community/model', tag)}>
                  <ModelTag model={tag} style={{ margin: 0 }} />
                </WorkspaceLink>
              ))}
          </MaskShadow>
        </Flexbox>
      </Block>
    );
  },
);

export default ProviderItem;
