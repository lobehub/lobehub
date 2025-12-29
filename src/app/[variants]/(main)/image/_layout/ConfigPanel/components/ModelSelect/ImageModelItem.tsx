import { ModelIcon } from '@lobehub/icons';
import { Flexbox, Text } from '@lobehub/ui';
import { Popover } from 'antd';
import { createStaticStyles, cx, useThemeMode } from 'antd-style';
import { type AiModelForSelect } from 'model-bank';
import numeral from 'numeral';
import { memo, useMemo } from 'react';

import NewModelBadge from '@/components/ModelSelect/NewModelBadge';

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
    showPopover = true,
    showBadge = true,
    ...model
  }) => {
    const { isDarkMode } = useThemeMode();

    const priceLabel = useMemo(() => {
      // Priority 1: Use exact price
      if (typeof pricePerImage === 'number') {
        return `${numeral(pricePerImage).format('$0,0.00[000]')} / image`;
      }

      // Priority 2: Use approximate price with prefix
      if (typeof approximatePricePerImage === 'number') {
        return `~ ${numeral(approximatePricePerImage).format('$0,0.00[000]')} / image`;
      }

      return undefined;
    }, [approximatePricePerImage, pricePerImage]);

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
      <Flexbox align={'center'} gap={8} horizontal style={{ overflow: 'hidden' }}>
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
        align={{
          offset: [24, -10],
        }}
        arrow={false}
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
