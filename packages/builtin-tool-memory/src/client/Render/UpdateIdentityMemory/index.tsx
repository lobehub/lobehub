'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import type { UpdateIdentityMemoryParams, UpdateIdentityMemoryState } from '../../../types';
import { getUpdateIdentityViewModel, IdentityMemoryCard } from '../../components';

const UpdateIdentityMemoryRender = memo<
  BuiltinRenderProps<UpdateIdentityMemoryParams, UpdateIdentityMemoryState>
>(({ args }) => {
  const { changedFields, identity, isEmpty, mergeStrategy } = getUpdateIdentityViewModel(args);

  if (isEmpty) return null;

  return (
    <Flexbox gap={8}>
      {/* An update only sends the fields it writes, so naming them is the whole story */}
      {changedFields.length > 0 && (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={12} type={'secondary'}>
            Updated
          </Text>
          {changedFields.map((field) => (
            <Tag key={field} size={'small'}>
              {field}
            </Tag>
          ))}
          {mergeStrategy && (
            <Text fontSize={12} type={'secondary'}>
              · {mergeStrategy}
            </Text>
          )}
        </Flexbox>
      )}
      <IdentityMemoryCard data={identity} fallbackTitle={'Updated Identity'} />
    </Flexbox>
  );
});

UpdateIdentityMemoryRender.displayName = 'UpdateIdentityMemoryRender';

export default UpdateIdentityMemoryRender;
