'use client';

import { Center, Empty, Markdown } from '@lobehub/ui';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { H1, H2, H3, H4, H5 } from './Toc/Heading';

const MarkdownRender = memo<{ children?: string }>(({ children }) => {
  const { t } = useTranslation('common');
  if (!children)
    return (
      <Center paddingBlock={32} width={'100%'}>
        <Empty
          description={t('noContent')}
          descriptionProps={{ fontSize: 14 }}
          icon={FileText}
          style={{ maxWidth: 400 }}
        />
      </Center>
    );

  return (
    <Markdown
      allowHtml
      components={{
        a: ({ href, ...rest }: { children?: ReactNode; href?: string }) => {
          if (href && href.startsWith('http'))
            return <Link {...rest} href={href} target={'_blank'} />;
          return rest?.children;
        },
        h1: H1,
        h2: H2,
        h3: H3,
        h4: H4,
        h5: H5,
        img: ({ src, ...rest }: { alt?: string; src?: string | Blob }) => {
          // FIXME ignore experimental blob image prop passing
          if (typeof src !== 'string') return null;
          if (src.includes('glama.ai')) return null;

          // eslint-disable-next-line @next/next/no-img-element
          if (src.startsWith('http')) return <img src={src} {...rest} />;
          return null;
        },
      }}
      enableImageGallery={false}
      enableLatex={false}
    >
      {children}
    </Markdown>
  );
});

export default MarkdownRender;
