'use client';

import { StyleProvider, extractStaticStyle } from 'antd-style';
import { useServerInsertedHTML } from 'next/navigation';
import { type PropsWithChildren, useRef } from 'react';

import { isDesktop } from '@/const/version';

const StyleRegistry = ({ children }: PropsWithChildren) => {
  const isInsert = useRef(false);

  useServerInsertedHTML(() => {
    // avoid duplicate css insert
    // refs: https://github.com/vercel/next.js/discussions/49354#discussioncomment-6279917
    if (isInsert.current) return;

    isInsert.current = true;
    const dark = extractStaticStyle(undefined, {
      injectTokenStyle: {
        appearance: 'dark',
        filter: 'color',
        selector: '[data-theme="dark"]',
      },
    });

    const darkCSS = dark.find((i) => i.key === 'ant-token-dark')!.style;

    return (
      <>
        {extractStaticStyle().map((item) => item.style)}
        {darkCSS}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html[data-theme="dark"], [data-theme="dark"] body { background-color: #000; }
              ${isDesktop ? 'html { background: none; }' : ''}
              ${isDesktop ? 'html[data-theme="dark"] body { background: color-mix(in srgb, #000 86%, transparent); }' : ''}
              ${isDesktop ? 'html[data-theme="light"] body { background: color-mix(in srgb, #f8f8f8 86%, transparent); }' : ''}
            `,
          }}
        />
      </>
    );
  });

  return <StyleProvider cache={extractStaticStyle.cache}>{children}</StyleProvider>;
};

export default StyleRegistry;
