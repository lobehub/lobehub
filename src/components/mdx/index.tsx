import { type TypographyProps } from '@lobehub/ui';
import { Typography as Typo } from '@lobehub/ui';
import { mdxComponents } from '@lobehub/ui/mdx';
import { type MDXRemoteProps } from 'next-mdx-remote/rsc';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { type FC } from 'react';
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

export const CustomMDX: FC<MDXRemoteProps & { mobile?: boolean }> = ({ mobile, ...rest }) => {
  // ref: https://github.com/hashicorp/next-mdx-remote/issues/405
  const list: any = {};
  Object.entries({
    ...mdxComponents,
    Image: Image,
    a: Link,
    pre: CodeBlock,
    ...rest.components,
  }).forEach(([key, Render]: any) => {
    list[key] = (props: any) => <Render {...props} />;
  });

  return (
    <Typography mobile={mobile}>
      <MDXRemote
        {...rest}
        components={list}
        // @ts-ignore
        options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
      />
    </Typography>
  );
};
