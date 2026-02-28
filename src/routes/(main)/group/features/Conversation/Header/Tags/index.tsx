import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MemberCountTag from './MemberCountTag';

/**
 * TitleTags for Group context - always shows MemberCountTag
 * since we're always in a group session here
 */
const TitleTags = memo(() => {
  return (
    <Flexbox horizontal align={'center'} gap={12}>
      <MemberCountTag />
    </Flexbox>
  );
});

export default TitleTags;
