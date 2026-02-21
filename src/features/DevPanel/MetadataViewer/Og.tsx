import { Flexbox, Form, Input, TextArea } from '@lobehub/ui';
import { memo } from 'react';

import Image from '@/libs/next/Image';

import { useHead } from './useHead';

const MetaData = memo(() => {
  const ogTitle = useHead('property', 'og:title');
  const ogDescription = useHead('property', 'og:description');
  const ogImage = useHead('property', 'og:image');

  return (
    <Form
      itemMinWidth={'max(75%,240px)'}
      itemsType={'flat'}
      variant={'borderless'}
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
              width={358}
              style={{
                background: 'rgba(0, 0, 0, .5)',
                borderRadius: 14,
                overflow: 'hidden',
                position: 'relative',
              }}
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
                fill
                alt={'og'}
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
    />
  );
});

export default MetaData;
