import { Form, Input, TextArea } from '@lobehub/ui';
import { memo } from 'react';

import { useHead, useTitle } from './useHead';

const MetaData = memo(() => {
  const title = useTitle();
  const description = useHead('name', 'description');

  return (
    <Form
      itemMinWidth={'max(75%,240px)'}
      itemsType={'flat'}
      variant={'borderless'}
      items={[
        {
          children: <Input value={title} variant={'filled'} />,
          label: `Title (${title.length})`,
        },
        {
          children: <TextArea rows={2} value={description} variant={'filled'} />,
          label: `Description (${description.length})`,
        },
      ]}
    />
  );
});

export default MetaData;
