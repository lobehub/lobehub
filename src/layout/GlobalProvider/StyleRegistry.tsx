'use client';

import { StyleProvider, extractStaticStyle } from 'antd-style';
import { useServerInsertedHTML } from 'next/navigation';
import { type PropsWithChildren, useRef } from 'react';

const StyleRegistry = ({ children }: PropsWithChildren) => {
  const isInsert = useRef(false);

  useServerInsertedHTML(() => {
    // avoid duplicate css insert
    // refs: https://github.com/vercel/next.js/discussions/49354#discussioncomment-6279917
    if (isInsert.current) return;

    isInsert.current = true;

    // @ts-ignore
    return extractStaticStyle().map((item) => item.style);
  });

  return <StyleProvider cache={extractStaticStyle.cache}>{children}</StyleProvider>;
};

export default StyleRegistry;
