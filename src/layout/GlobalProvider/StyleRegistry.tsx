'use client';

import { StyleProvider } from 'antd-style';
import { useServerInsertedHTML } from 'next/navigation';
import { type PropsWithChildren } from 'react';

import { isDesktop } from '@/const/version';

const StyleRegistry = ({ children }: PropsWithChildren) => {
  useServerInsertedHTML(() => {
    return (
      <style
        dangerouslySetInnerHTML={{
          __html: `
              html[data-theme="dark"] { background-color: #000; }
              ${isDesktop ? 'html { background: none; }' : ''}
              ${isDesktop ? 'html[data-theme="dark"] { background: color-mix(in srgb, #000 86%, transparent); }' : ''}
              ${isDesktop ? 'html[data-theme="light"] { background: color-mix(in srgb, #f8f8f8 86%, transparent); }' : ''}
            `,
        }}
      />
    );
  });

  return <StyleProvider>{children}</StyleProvider>;
};

export default StyleRegistry;
