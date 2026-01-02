import { Flexbox, Form, Input, TextArea } from '@lobehub/ui';
import Image from 'next/image';
import { memo } from 'react';

import { useHead } from './useHead';

const MetaData = memo(() => {
  const ogTitle = useHead('property', 'og:title');
  const ogDescription = useHead('property', 'og:description');
  const ogImage = useHead('property', 'og:image');

  return (
    <Form
      itemMinWidth={'max(75%,240px)'}
      items={[
        {
          children: <Input value={ogTitle} variant={'filled'} />,
          label: `OG Title (${ogTitle.length})`,
        },
        {
          children: <TextArea rows={2} value={ogDescription} variant={'filled'} />,
          label: `OG Description (${ogDescription.length})`,
        },
        {
          children: (
            <Flexbox
              height={186}
              style={{
                background: 'rgba(0, 0, 0, .5)',
                borderRadius: 14,
                overflow: 'hidden',
                position: 'relative',
              }}
              width={358}
            >
              <div
                style={{
                  background: 'rgba(0, 0, 0, .5)',
                  borderRadius: 4,
                  bottom: 10,
                  left: 10,
                  lineHeight: 1.3,
                  padding: '2px 6px',
                  position: 'absolute',
                  zIndex: 10,
                }}
              >
                lobehub.com
              </div>
              <Image
                alt={'og'}
                fill
                src={ogImage}
                style={{ objectFit: 'cover' }}
                unoptimized={true}
              />
            </Flexbox>
          ),
          label: 'Og Image',
          minWidth: undefined,
        },
        {
          children: <Input value={ogImage} variant={'filled'} />,
          label: 'Og Image Url',
        },
      ]}
      itemsType={'flat'}
      variant={'borderless'}
    />
  );
});

export default MetaData;
