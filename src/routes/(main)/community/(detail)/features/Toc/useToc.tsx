'use client';

import { type AnchorProps } from 'antd';
import { unionBy } from 'es-toolkit/compat';
import { type FC, type PropsWithChildren } from 'react';
import { createContext, use, useState } from 'react';

interface TocState {
  isLoading: boolean;
  setFinished: () => void;
  setToc: (data: any) => void;
  toc?: AnchorProps['items'];
}

const TocContext = createContext<TocState>({
  isLoading: true,
  setFinished: () => {},
  setToc: () => {},
  toc: [],
});

export interface TOCItem {
  href: string;
  level: number;
  title: string;
}

export const TocProvider: FC<PropsWithChildren> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<AnchorProps['items']>([]);
  return (
    <TocContext
      value={{
        isLoading: loading,
        setFinished: () => setLoading(false),
        setToc: (data: AnchorProps['items']) => {
          setToc(data);
        },
        toc,
      }}
    >
      {children}
    </TocContext>
  );
};

export const useToc = () => {
  return use(TocContext);
};

export function createTOCTree(items: TOCItem[]): AnchorProps['items'] {
  const tocTree: AnchorProps['items'] = [];
  let index = 1;

  for (const item of unionBy(items, 'href')) {
    const tocItem = { href: item.href, key: index, title: item.title };

    const preNode = tocTree.at(-1);

    if (item.level === 2) {
      tocTree.push({ ...tocItem, children: [] });
    } else {
      // @ts-ignore
      if (preNode && preNode.children) {
        preNode.children.push(tocItem);
      } else {
        tocTree.push(tocItem);
      }
    }

    index++;
  }
  return tocTree;
}
