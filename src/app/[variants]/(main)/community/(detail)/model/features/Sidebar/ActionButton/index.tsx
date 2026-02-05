'use client';

import { ModelIcon } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';

import ShareButton from '../../../../features/ShareButton';
import { useDetailContext } from '../../DetailProvider';
import ChatWithModel from './ChatWithModel';

const ActionButton = memo(() => {
  const { description, providers, displayName, identifier } = useDetailContext();
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <ChatWithModel />
      <ShareButton
        meta={{
          avatar: <ModelIcon model={identifier} size={64} type={'avatar'} />,
          desc: description,
          hashtags: providers?.map((item) => item.name) || [],
          title: displayName || identifier,
          url: urlJoin(OFFICIAL_URL, '/community/model', identifier as string),
        }}
      />
    </Flexbox>
  );
});

export default ActionButton;
