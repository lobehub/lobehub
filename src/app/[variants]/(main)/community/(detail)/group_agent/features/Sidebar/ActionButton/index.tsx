'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';

import ShareButton from '../../../../features/ShareButton';
import { useDetailData } from '../../DetailProvider';
import AddGroupAgent from './AddGroupAgent';

const ActionButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const data = useDetailData();
  const { group, currentVersion } = data;

  const avatar = currentVersion?.avatar;
  const title = currentVersion?.name || group.name;
  const description = currentVersion?.description;
  const tags = currentVersion?.tags;
  const identifier = group.identifier;

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      <AddGroupAgent mobile={mobile} />
      <ShareButton
        meta={{
          avatar: avatar,
          desc: description,
          hashtags: tags,
          title: title,
          url: urlJoin(OFFICIAL_URL, '/community/group_agent', identifier as string),
        }}
      />
    </Flexbox>
  );
});

export default ActionButton;
