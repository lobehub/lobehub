import { ModelIcon } from '@lobehub/icons';
import { Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { AiModelForSelect } from 'model-bank';
import { memo, useMemo } from 'react';

import NewModelBadge from '@/components/ModelSelect/NewModelBadge';
import { useIsDark } from '@/hooks/useIsDark';

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
}));

type VideoModelItemProps = AiModelForSelect & {
  providerId?: string;
  showBadge?: boolean;
  showPopover?: boolean;
};

const VideoModelItem = memo<VideoModelItemProps>(
  ({ description, showPopover = true, showBadge = true, ...model }) => {
    const isDarkMode = useIsDark();

    const popoverContent = useMemo(() => {
      if (!description) return null;

      return (
        <Flexbox gap={8} style={{ maxWidth: POPOVER_MAX_WIDTH }}>
          <Text className={cx(styles.descriptionText, isDarkMode && styles.descriptionText_dark)}>
            {description}
          </Text>
        </Flexbox>
      );
    }, [description, isDarkMode]);

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
        classNames={{ root: cx(styles.popover, isDarkMode && styles.popover_dark) }}
        content={popoverContent}
        placement="rightTop"
      >
        {content}
      </Popover>
    );
  },
);

VideoModelItem.displayName = 'VideoModelItem';

export default VideoModelItem;
