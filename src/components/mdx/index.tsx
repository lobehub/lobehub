import { type TypographyProps } from '@lobehub/ui';
import { Typography as Typo } from '@lobehub/ui';
import { mdxComponents } from '@lobehub/ui/mdx';
import { type FC } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CodeBlock from './CodeBlock';
import Image from './Image';
import Link from './Link';

export const Typography = ({
  children,
  mobile,
  style,
  ...rest
}: { mobile?: boolean } & TypographyProps) => {
  const headerMultiple = mobile ? 0.2 : 0.4;
  return (
    <Typo
      fontSize={14}
      headerMultiple={headerMultiple}
      style={{ width: '100%', ...style }}
      {...rest}
    >
      {children}
    </Typo>
  );
};

interface CustomMDXProps {
  components?: Components;
  mobile?: boolean;
  source: string;
}

export const CustomMDX: FC<CustomMDXProps> = ({ mobile, source, components: extraComponents }) => {
  const components: Components = {
    ...(mdxComponents as Components),
    a: Link as Components['a'],
    img: Image as Components['img'],
    pre: CodeBlock as Components['pre'],
    ...extraComponents,
  };

  return (
    <Typography mobile={mobile}>
      <Markdown components={components} remarkPlugins={[remarkGfm]}>
        {source}
      </Markdown>
    </Typography>
  );
};
