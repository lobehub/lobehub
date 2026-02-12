'use client';

import { StyleProvider } from 'antd-style';
import { type PropsWithChildren } from 'react';

import { isDesktop } from '@/const/version';
import { useServerInsertedHTML } from '@/libs/next/navigation';

const StyleRegistry = ({ children }: PropsWithChildren) => {
  useServerInsertedHTML(() => {
    return (
      <style
        dangerouslySetInnerHTML={{
          __html: `
              html body {background: #f8f8f8;}
              html[data-theme="dark"] body { background-color: #000; }
              ${isDesktop ? 'html body, html { background: none; }' : ''}
              ${isDesktop ? 'html[data-theme="dark"] body { background: color-mix(in srgb, #000 86%, transparent); }' : ''}
              ${isDesktop ? 'html[data-theme="light"] body { background: color-mix(in srgb, #f8f8f8 86%, transparent); }' : ''}
            `,
        }}
      />
    );
  });

  return <StyleProvider>{children}</StyleProvider>;
};

export default StyleRegistry;
