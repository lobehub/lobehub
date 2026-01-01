import { type FC, type ReactNode } from 'react';

export interface MarkdownElementProps<T = any> {
  children: ReactNode;
  id: string;
  node: {
    properties: T;
  };
  tagName: string;
  type: string;
}

export type MarkdownPluginScope = 'user' | 'assistant' | 'all';

export interface MarkdownElement {
  Component: FC<MarkdownElementProps>;
  rehypePlugin?: any;
  remarkPlugin?: any;
  scope: MarkdownPluginScope;
  tag: string;
}
