import { type ChatModelCard } from '@lobechat/types';
import { type IconAvatarProps } from '@lobehub/icons';
import { LobeHub, ModelIcon, ProviderIcon } from '@lobehub/icons';
import { type FlexboxProps } from '@lobehub/ui';
import { Avatar, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import {
  AtomIcon,
  Infinity,
  LucideEye,
  LucideGlobe,
  LucideImage,
  LucidePaperclip,
  ToyBrick,
  Video,
} from 'lucide-react';
import { type ModelAbilities } from 'model-bank';
import numeral from 'numeral';
import { type CSSProperties, type FC } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AiProviderSourceType } from '@/types/aiProvider';
import { formatTokenNumber } from '@/utils/format';

import NewModelBadgeI18n, { NewModelBadge as NewModelBadgeCore } from './NewModelBadge';

export const TAG_CLASSNAME = 'lobe-model-info-tags';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tag: css`
    cursor: default;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px !important;
    height: 20px;
    border-radius: 4px;
  `,
  token: css`
    width: 36px !important;
    height: 20px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

type TooltipStyles = typeof styles;

interface ModelInfoTagsProps extends ModelAbilities {
  contextWindowTokens?: number | null;
  directionReverse?: boolean;
  isCustom?: boolean;
  placement?: 'top' | 'right';
  style?: CSSProperties;
}

interface FeatureTagsProps extends Pick<
  ModelAbilities,
  'files' | 'imageOutput' | 'vision' | 'video' | 'functionCall' | 'reasoning' | 'search'
> {
  placement: 'top' | 'right';
  tagClassName: string;
}

interface FeatureTagItemProps {
  className: string;
  color: Parameters<typeof Tag>[0]['color'];
  enabled: boolean | undefined;
  icon: Parameters<typeof Icon>[0]['icon'];
  placement: 'top' | 'right';
  title: string;
}

const FeatureTagItem = memo<FeatureTagItemProps>(
  ({ className, color, enabled, icon, placement, title }) => {
    if (!enabled) return null;

    const tag = (
      <Tag className={className} color={color} size={'small'}>
        <Icon icon={icon} />
      </Tag>
    );

    return (
      <Tooltip placement={placement} title={title}>
        {tag}
      </Tooltip>
    );
  },
);

const FeatureTags = memo<FeatureTagsProps>(
  ({
    files,
    functionCall,
    imageOutput,
    placement,
    reasoning,
    search,
    tagClassName,
    video,
    vision,
  }) => {
    const { t } = useTranslation('components');

    return (
      <>
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          enabled={files}
          icon={LucidePaperclip}
          placement={placement}
          title={t('ModelSelect.featureTag.file')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          enabled={imageOutput}
          icon={LucideImage}
          placement={placement}
          title={t('ModelSelect.featureTag.imageOutput')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          enabled={vision}
          icon={LucideEye}
          placement={placement}
          title={t('ModelSelect.featureTag.vision')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'magenta'}
          enabled={video}
          icon={Video}
          placement={placement}
          title={t('ModelSelect.featureTag.video')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'info'}
          enabled={functionCall}
          icon={ToyBrick}
          placement={placement}
          title={t('ModelSelect.featureTag.functionCall')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'purple'}
          enabled={reasoning}
          icon={AtomIcon}
          placement={placement}
          title={t('ModelSelect.featureTag.reasoning')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'cyan'}
          enabled={search}
          icon={LucideGlobe}
          placement={placement}
          title={t('ModelSelect.featureTag.search')}
        />
      </>
    );
  },
);

const Context = memo(
  ({
    contextWindowTokens,
    placement,
    styles,
  }: {
    contextWindowTokens: number;
    placement: 'top' | 'right';
    styles: TooltipStyles;
  }) => {
    const { t } = useTranslation('components');
    const tokensText = contextWindowTokens === 0 ? '∞' : formatTokenNumber(contextWindowTokens);

    const tag = (
      <Tag className={styles.token} size={'small'}>
        {contextWindowTokens === 0 ? <Infinity size={17} strokeWidth={1.6} /> : tokensText}
      </Tag>
    );

    return (
      <Tooltip
        placement={placement}
        // styles={styles}
        title={t('ModelSelect.featureTag.tokens', {
          tokens: contextWindowTokens === 0 ? '∞' : numeral(contextWindowTokens).format('0,0'),
        })}
      >
        {tag}
      </Tooltip>
    );
  },
);

export const ModelInfoTags = memo<ModelInfoTagsProps>(
  ({ directionReverse, placement = 'top', style, ...model }) => {
    return (
      <Flexbox
        className={TAG_CLASSNAME}
        direction={directionReverse ? 'horizontal-reverse' : 'horizontal'}
        gap={2}
        style={{ marginLeft: 'auto', ...style }}
        width={'fit-content'}
      >
        <FeatureTags
          files={model.files}
          functionCall={model.functionCall}
          imageOutput={model.imageOutput}
          placement={placement}
          reasoning={model.reasoning}
          search={model.search}
          tagClassName={styles.tag}
          video={model.video}
          vision={model.vision}
        />
        {typeof model.contextWindowTokens === 'number' && (
          <Context
            contextWindowTokens={model.contextWindowTokens}
            placement={placement}
            styles={styles}
          />
        )}
      </Flexbox>
    );
  },
);

interface ModelItemRenderProps extends ChatModelCard, Partial<Omit<FlexboxProps, 'id' | 'title'>> {
  abilities?: ModelAbilities;
  newBadgeLabel?: string;
  showInfoTag?: boolean;
}

export const ModelItemRender = memo<ModelItemRenderProps>(
  ({
    showInfoTag = true,
    abilities,
    contextWindowTokens,
    files,
    functionCall,
    imageOutput,
    newBadgeLabel,
    reasoning,
    search,
    video,
    vision,
    id,
    displayName,
    releasedAt,
    ...rest
  }) => {
    const { mobile } = useResponsive();
    const displayNameOrId = displayName || id;

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={32}
        justify={'space-between'}
        {...rest}
        style={{
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
          ...rest.style,
        }}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}
        >
          <ModelIcon model={id} size={20} />
          <Text
            style={mobile ? { maxWidth: '60vw' } : { minWidth: 0, overflow: 'hidden' }}
            ellipsis={{
              tooltip: displayNameOrId,
              tooltipWhenOverflow: true,
            }}
          >
            {displayNameOrId}
          </Text>
          {newBadgeLabel ? (
            <NewModelBadgeCore label={newBadgeLabel} releasedAt={releasedAt} />
          ) : (
            <NewModelBadgeI18n releasedAt={releasedAt} />
          )}
        </Flexbox>
        {showInfoTag && (
          <ModelInfoTags
            contextWindowTokens={contextWindowTokens}
            files={files ?? abilities?.files}
            functionCall={functionCall ?? abilities?.functionCall}
            imageOutput={imageOutput ?? abilities?.imageOutput}
            reasoning={reasoning ?? abilities?.reasoning}
            search={search ?? abilities?.search}
            style={{ zoom: 0.9 }}
            video={video ?? abilities?.video}
            vision={vision ?? abilities?.vision}
          />
        )}
      </Flexbox>
    );
  },
);

interface ProviderItemRenderProps {
  logo?: string;
  name: string;
  provider: string;
  size?: number;
  source?: AiProviderSourceType;
  type?: 'mono' | 'color' | 'avatar';
}

export const ProviderItemRender = memo<ProviderItemRenderProps>(
  ({ provider, name, source, logo, type = 'mono', size = 16 }) => {
    const isMono = type === 'mono';
    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={6}
        width={'100%'}
        style={{
          overflow: 'hidden',
        }}
      >
        {source === 'custom' && !!logo ? (
          <Avatar
            avatar={logo}
            shape={'circle'}
            size={size}
            style={isMono ? { filter: 'grayscale(1)' } : {}}
            title={name}
          />
        ) : provider === 'lobehub' ? (
          <LobeHub.Morden size={size} />
        ) : (
          <ProviderIcon provider={provider} size={size} type={type} />
        )}
        <Text ellipsis color={'inherit'}>
          {name}
        </Text>
      </Flexbox>
    );
  },
);

interface LabelRendererProps {
  Icon: FC<IconAvatarProps>;
  label: string;
}

export const LabelRenderer = memo<LabelRendererProps>(({ Icon, label }) => (
  <Flexbox horizontal align={'center'} gap={8}>
    <Icon size={20} />
    <span>{label}</span>
  </Flexbox>
));
