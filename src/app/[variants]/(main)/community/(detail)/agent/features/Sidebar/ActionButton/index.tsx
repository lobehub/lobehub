'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';

import ShareButton from '../../../../features/ShareButton';
import { useDetailContext } from '../../DetailProvider';
import ForkAndChat from './ForkAndChat';

const ActionButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { avatar, description, tags, title, identifier } = useDetailContext();
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <ForkAndChat mobile={mobile} />
      <ShareButton
        meta={{
          avatar: avatar,
          desc: description,
          hashtags: tags,
          title: title,
          url: urlJoin(OFFICIAL_URL, '/community/agent', identifier as string),
        }}
      />
    </Flexbox>
  );
});

export default ActionButton;
