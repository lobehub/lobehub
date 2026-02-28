import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { ModelIcon } from '@lobehub/icons';
import { Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type AiModelForSelect } from 'model-bank';
import numeral from 'numeral';
import { memo, useMemo } from 'react';

import NewModelBadge from '@/components/ModelSelect/NewModelBadge';
import { useIsDark } from '@/hooks/useIsDark';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

const POPOVER_MAX_WIDTH = 320;

const styles = createStaticStyles(({ css, cssVar }) => ({
  descriptionText: css`
    color: ${cssVar.colorTextSecondary};
  `,
  descriptionText_dark: css`
    color: ${cssVar.colorText};
  `,
  popover: css`
    .ant-popover-inner {
      background: ${cssVar.colorBgElevated};
    }
  `,
  popover_dark: css`
    .ant-popover-inner {
      background: ${cssVar.colorBgSpotlight};
    }
  `,
  priceText: css`
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  priceText_dark: css`
    font-weight: 500;
    color: ${cssVar.colorTextLightSolid};
  `,
}));

type ImageModelItemProps = AiModelForSelect & {
  /**
   * Provider ID for determining price display format
   */
  providerId?: string;
  /**
   * Whether to show new model badge
   * @default true
   */
  showBadge?: boolean;
  /**
   * Whether to show popover on hover
   * @default true
   */
  showPopover?: boolean;
};

const ImageModelItem = memo<ImageModelItemProps>(
  ({
    approximatePricePerImage,
    description,
    pricePerImage,
    providerId,
    showPopover = true,
    showBadge = true,
    ...model
  }) => {
    const isDarkMode = useIsDark();
    const enableBusinessFeatures = useServerConfigStore(
      serverConfigSelectors.enableBusinessFeatures,
    );

    const priceLabel = useMemo(() => {
      // Show credits only for branding provider with business features enabled
      if (enableBusinessFeatures && providerId === BRANDING_PROVIDER) {
        if (typeof pricePerImage === 'number') {
          const credits = pricePerImage * CREDITS_PER_DOLLAR;
          return `${numeral(credits).format('0,0')} credits/张`;
        }
        if (typeof approximatePricePerImage === 'number') {
          const credits = approximatePricePerImage * CREDITS_PER_DOLLAR;
          return `~ ${numeral(credits).format('0,0')} credits/张`;
        }
      } else {
        // Show USD price for open source version or non-branding providers
        if (typeof pricePerImage === 'number') {
          return `${numeral(pricePerImage).format('$0,0.00[000]')} / image`;
        }
        if (typeof approximatePricePerImage === 'number') {
          return `~ ${numeral(approximatePricePerImage).format('$0,0.00[000]')} / image`;
        }
      }

      return undefined;
    }, [approximatePricePerImage, enableBusinessFeatures, pricePerImage, providerId]);

    const popoverContent = useMemo(() => {
      if (!description && !priceLabel) return null;

      return (
        <Flexbox gap={8} style={{ maxWidth: POPOVER_MAX_WIDTH }}>
          {description && (
            <Text className={cx(styles.descriptionText, isDarkMode && styles.descriptionText_dark)}>
              {description}
            </Text>
          )}
          {priceLabel && (
            <Text className={cx(styles.priceText, isDarkMode && styles.priceText_dark)}>
              {priceLabel}
            </Text>
          )}
        </Flexbox>
      );
    }, [description, priceLabel, isDarkMode]);

    const content = (
      <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
        <ModelIcon model={model.id} size={20} />
        <Text ellipsis title={model.displayName || model.id}>
          {model.displayName || model.id}
        </Text>
        {showBadge && <NewModelBadge releasedAt={model.releasedAt} />}
      </Flexbox>
    );

    if (!showPopover || !popoverContent) return content;

    return (
      <Popover
        classNames={{ root: cx(styles.popover, isDarkMode && styles.popover_dark) }}
        content={popoverContent}
        placement="rightTop"
      >
        {content}
      </Popover>
    );
  },
);

ImageModelItem.displayName = 'ImageModelItem';

export default ImageModelItem;
