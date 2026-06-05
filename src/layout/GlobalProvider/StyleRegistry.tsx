'use client';

import { StyleProvider } from 'antd-style';
import { useServerInsertedHTML } from 'next/navigation';
import { type PropsWithChildren } from 'react';

const StyleRegistry = ({ children }: PropsWithChildren) => {
  useServerInsertedHTML(() => {
    return (
      <style
        dangerouslySetInnerHTML={{
          __html: `
              html body { background: #f5f5f5; }
              html[data-theme="dark"] body { background: #0d0d0d; }
            `,
        }}
      />
    );
  });

  return <StyleProvider>{children}</StyleProvider>;
};

export default StyleRegistry;
