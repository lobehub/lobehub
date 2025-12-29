import { type ChatModelCard } from '@lobechat/types';
import { type IconAvatarProps, ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import {
  Infinity,
  AtomIcon,
  LucideEye,
  LucideGlobe,
  LucideImage,
  LucidePaperclip,
  ToyBrick,
  Video,
} from 'lucide-react';
import { type ModelAbilities } from 'model-bank';
import numeral from 'numeral';
import { type ComponentProps, type FC, memo, useState } from 'react';
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

const DEFAULT_TOOLTIP_STYLES = {
  root: { pointerEvents: 'none' },
} as const satisfies ComponentProps<typeof Tooltip>['styles'];

const FUNCTION_CALL_TOOLTIP_STYLES = {
  root: { maxWidth: 'unset', pointerEvents: 'none' },
} as const satisfies ComponentProps<typeof Tooltip>['styles'];

interface ModelInfoTagsProps extends ModelAbilities {
  contextWindowTokens?: number | null;
  directionReverse?: boolean;
  isCustom?: boolean;
  placement?: 'top' | 'right';
  /**
   * Whether to render tooltip overlays for each tag.
   * Disable this when rendering a large list (e.g. dropdown menus) to avoid mounting hundreds of Tooltip instances.
   *
   * When `false`, tags are rendered without any tooltip/title fallback by design.
   */
  withTooltip?: boolean;
}

interface FeatureTagsProps extends Pick<
  ModelAbilities,
  'files' | 'imageOutput' | 'vision' | 'video' | 'functionCall' | 'reasoning' | 'search'
> {
  placement: 'top' | 'right';
  tagClassName: string;
  withTooltip: boolean;
}

interface FeatureTagItemProps {
  className: string;
  color: Parameters<typeof Tag>[0]['color'];
  enabled: boolean | undefined;
  icon: Parameters<typeof Icon>[0]['icon'];
  placement: 'top' | 'right';
  title: string;
  tooltipStyles?: ComponentProps<typeof Tooltip>['styles'];
  withTooltip: boolean;
}

const FeatureTagItem = memo<FeatureTagItemProps>(
  ({ className, color, enabled, icon, placement, title, tooltipStyles, withTooltip }) => {
    if (!enabled) return null;

    const tag = (
      <Tag className={className} color={color} size={'small'}>
        <Icon icon={icon} />
      </Tag>
    );

    if (!withTooltip) return tag;

    return (
      <Tooltip placement={placement} styles={tooltipStyles ?? DEFAULT_TOOLTIP_STYLES} title={title}>
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
    withTooltip,
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
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          enabled={imageOutput}
          icon={LucideImage}
          placement={placement}
          title={t('ModelSelect.featureTag.imageOutput')}
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          enabled={vision}
          icon={LucideEye}
          placement={placement}
          title={t('ModelSelect.featureTag.vision')}
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'magenta'}
          enabled={video}
          icon={Video}
          placement={placement}
          title={t('ModelSelect.featureTag.video')}
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'info'}
          enabled={functionCall}
          icon={ToyBrick}
          placement={placement}
          title={t('ModelSelect.featureTag.functionCall')}
          tooltipStyles={FUNCTION_CALL_TOOLTIP_STYLES}
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'purple'}
          enabled={reasoning}
          icon={AtomIcon}
          placement={placement}
          title={t('ModelSelect.featureTag.reasoning')}
          withTooltip={withTooltip}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'cyan'}
          enabled={search}
          icon={LucideGlobe}
          placement={placement}
          title={t('ModelSelect.featureTag.search')}
          withTooltip={withTooltip}
        />
      </>
    );
  },
);

const Context = memo(
  ({
    contextWindowTokens,
    withTooltip,
    placement,
    styles,
  }: {
    contextWindowTokens: number;
    placement: 'top' | 'right';
    styles: TooltipStyles;
    withTooltip: boolean;
  }) => {
    const { t } = useTranslation('components');
    const tokensText = contextWindowTokens === 0 ? '∞' : formatTokenNumber(contextWindowTokens);

    const tag = (
      <Tag className={styles.token} size={'small'}>
        {contextWindowTokens === 0 ? <Infinity size={17} strokeWidth={1.6} /> : tokensText}
      </Tag>
    );

    if (!withTooltip) return tag;

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
  ({ directionReverse, placement = 'top', withTooltip = true, ...model }) => {
    return (
      <Flexbox
        className={TAG_CLASSNAME}
        direction={directionReverse ? 'horizontal-reverse' : 'horizontal'}
        gap={4}
        style={{ marginLeft: 'auto' }}
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
          withTooltip={withTooltip}
        />
        {typeof model.contextWindowTokens === 'number' && (
          <Context
            contextWindowTokens={model.contextWindowTokens}
            placement={placement}
            styles={styles}
            withTooltip={withTooltip}
          />
        )}
      </Flexbox>
    );
  },
);

interface ModelItemRenderProps extends ChatModelCard {
  abilities?: ModelAbilities;
  infoTagTooltip?: boolean;
  /**
   * Only mounts Tooltip components while hovering the item, to reduce initial render cost in large dropdown lists.
   *
   * Note: hover is not available on mobile, so this will be ignored on mobile.
   * Also note: since tooltips are mounted lazily, the very first hover may require a tiny pointer movement
   * before the tooltip system detects the hover target (depends on the underlying tooltip implementation).
   */
  infoTagTooltipOnHover?: boolean;
  newBadgeLabel?: string;
  showInfoTag?: boolean;
}

export const ModelItemRender = memo<ModelItemRenderProps>(({ showInfoTag = true, ...model }) => {
  const { mobile } = useResponsive();
  const [hovered, setHovered] = useState(false);
  const {
    abilities,
    infoTagTooltip = true,
    infoTagTooltipOnHover = false,
    contextWindowTokens,
    files,
    functionCall,
    imageOutput,
    newBadgeLabel,
    reasoning,
    search,
    video,
    vision,
  } = model;

  const shouldLazyMountTooltip = infoTagTooltipOnHover && !mobile;
  /**
   * When `infoTagTooltipOnHover` is enabled, we don't mount Tooltip components until the row is hovered.
   * This avoids creating many overlays on dropdown open, while keeping the tooltip UX on demand.
   */
  const withTooltip = infoTagTooltip && (!shouldLazyMountTooltip || hovered);
  const displayName = model.displayName || model.id;

  return (
    <Flexbox
      align={'center'}
      gap={32}
      horizontal
      justify={'space-between'}
      onMouseEnter={shouldLazyMountTooltip && !hovered ? () => setHovered(true) : undefined}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Flexbox
        align={'center'}
        gap={8}
        horizontal
        style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}
      >
        <ModelIcon model={model.id} size={20} />
        <Text
          ellipsis={
            withTooltip
              ? {
                  tooltip: displayName,
                }
              : true
          }
          style={mobile ? { maxWidth: '60vw' } : { minWidth: 0, overflow: 'hidden' }}
        >
          {displayName}
        </Text>
        {newBadgeLabel ? (
          <NewModelBadgeCore label={newBadgeLabel} releasedAt={model.releasedAt} />
        ) : (
          <NewModelBadgeI18n releasedAt={model.releasedAt} />
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
          video={video ?? abilities?.video}
          vision={vision ?? abilities?.vision}
          withTooltip={withTooltip}
        />
      )}
    </Flexbox>
  );
});

interface ProviderItemRenderProps {
  logo?: string;
  name: string;
  provider: string;
  source?: AiProviderSourceType;
}

export const ProviderItemRender = memo<ProviderItemRenderProps>(
  ({ provider, name, source, logo }) => {
    return (
      <Flexbox align={'center'} gap={4} horizontal>
        {source === 'custom' && !!logo ? (
          <Avatar avatar={logo} size={20} style={{ filter: 'grayscale(1)' }} title={name} />
        ) : (
          <ProviderIcon provider={provider} size={20} type={'mono'} />
        )}
        {name}
      </Flexbox>
    );
  },
);

interface LabelRendererProps {
  Icon: FC<IconAvatarProps>;
  label: string;
}

export const LabelRenderer = memo<LabelRendererProps>(({ Icon, label }) => (
  <Flexbox align={'center'} gap={8} horizontal>
    <Icon size={20} />
    <span>{label}</span>
  </Flexbox>
));
