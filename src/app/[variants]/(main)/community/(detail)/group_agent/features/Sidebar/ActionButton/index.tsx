'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';

import ShareButton from '../../../../features/ShareButton';
import { useDetailContext } from '../../DetailProvider';
import AddGroupAgent from './AddGroupAgent';

const ActionButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { avatar, title, description, tags, identifier } = useDetailContext();

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      <AddGroupAgent mobile={mobile} />
      {identifier && (
        <ShareButton
          meta={{
            avatar: avatar,
            desc: description,
            hashtags: tags,
            title: title,
            url: urlJoin(OFFICIAL_URL, '/community/group_agent', identifier),
          }}
        />
      )}
    </Flexbox>
  );
});

export default ActionButton;
