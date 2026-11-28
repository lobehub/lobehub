import type { ChannelMessagePostedFor } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * After the author of a shared Agent's post for someone not in this Channel: whom it was sent
 * for, linking back to where they asked when that Channel is public.
 */
const PostedForLabel = memo<{ postedFor: ChannelMessagePostedFor }>(({ postedFor }) => {
  const { t } = useTranslation('channel');
  const { name, source } = postedFor;

  if (!source)
    return (
      <Text ellipsis fontSize={12} type="secondary">
        {t('message.postedFor', { name })}
      </Text>
    );

  return (
    <a href={source.url} style={{ minWidth: 0 }}>
      <Text ellipsis fontSize={12} type="secondary">
        {t('message.postedForFrom', { channel: source.title, name })}
      </Text>
    </a>
  );
});

PostedForLabel.displayName = 'PostedForLabel';

export default PostedForLabel;
