'use client';

import { Mermaid } from '@lobehub/ui';
import { Pre, PreSingleLine } from '@lobehub/ui/mdx';
import { type FC, type PropsWithChildren } from 'react';

const countLines = (str: string): number => {
  const regex = /\n/g;
  const matches = str.match(regex);
  return matches ? matches.length : 1;
};

const extractText = (node: any): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');

  if (node.props) {
    if (node.type === 'br') return '<br>';
    if (node.props.children) return extractText(node.props.children);
  }
  return '';
};

const useCode = (raw: any) => {
  if (!raw) return;

  const { children, className } = raw.props;

  if (!children) return;

  const content = extractText(children).trim();

  const lang = className?.replace('language-', '') || 'txt';

  const isSingleLine = countLines(content) <= 1 && content.length <= 32;

  return {
    content,
    isSingleLine,
    lang,
  };
};

const CodeBlock: FC<PropsWithChildren> = ({ children }) => {
  const code = useCode(children);

  if (!code) return;

  if (code.isSingleLine) return <PreSingleLine language={code.lang}>{code.content}</PreSingleLine>;
  if (code.lang === 'mermaid') {
    return <Mermaid variant={'borderless'}>{code.content}</Mermaid>;
  }
  return (
    <Pre fullFeatured allowChangeLanguage={false} language={code.lang}>
      {code.content}
    </Pre>
  );
};

export default CodeBlock;
