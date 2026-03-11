'use client';

import { type SkillItem } from '@lobechat/types';
import { CopyButton, Highlighter, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  codeWrapper: css`
    position: relative;
    overflow-x: auto;
    margin-block-start: 16px;
    padding-block-end: calc(100cqb - 1lh);

    pre {
      margin: 0;
    }

    code {
      counter-reset: line;
    }

    .line {
      width: 100% !important;
      margin-inline: 0 !important;
      padding-inline: 0 !important;
    }

    .line::before {
      content: counter(line);
      counter-increment: line;
      user-select: none;

      display: inline-block;

      width: 4ch;
      margin-inline-end: 2ch;

      color: ${cssVar.colorTextQuaternary};
      text-align: end;
    }
  `,
  docWrapper: css`
    max-width: 798px;
    margin-inline: auto;
    padding-block: 8px;
    padding-inline: 24px;
  `,
}));

const getLanguage = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs': {
      return 'javascript';
    }
    case 'ts': {
      return 'typescript';
    }
    case 'tsx': {
      return 'tsx';
    }
    case 'jsx': {
      return 'jsx';
    }
    case 'py':
    case 'pyw': {
      return 'python';
    }
    case 'java': {
      return 'java';
    }
    case 'go': {
      return 'go';
    }
    case 'rs': {
      return 'rust';
    }
    case 'rb': {
      return 'ruby';
    }
    case 'sh':
    case 'bash':
    case 'zsh': {
      return 'bash';
    }
    case 'html':
    case 'htm': {
      return 'html';
    }
    case 'css': {
      return 'css';
    }
    case 'scss': {
      return 'scss';
    }
    case 'json': {
      return 'json';
    }
    case 'xml': {
      return 'xml';
    }
    case 'yaml':
    case 'yml': {
      return 'yaml';
    }
    case 'toml': {
      return 'toml';
    }
    case 'md':
    case 'mdx': {
      return 'markdown';
    }
    case 'sql': {
      return 'sql';
    }
    case 'c':
    case 'h': {
      return 'c';
    }
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'hpp': {
      return 'cpp';
    }
    case 'cs': {
      return 'csharp';
    }
    case 'swift': {
      return 'swift';
    }
    case 'kt':
    case 'kts': {
      return 'kotlin';
    }
    case 'lua': {
      return 'lua';
    }
    case 'dart': {
      return 'dart';
    }
    case 'graphql':
    case 'gql': {
      return 'graphql';
    }
    default: {
      return 'txt';
    }
  }
};

const isMarkdownFile = (path: string) => {
  const ext = path.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'mdx';
};

const parseFrontmatter = (content: string): { body: string; frontmatter?: string } => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content };
  return { body: match[2], frontmatter: match[1] };
};

interface ContentViewerProps {
  contentMap: Record<string, string>;
  liveContent?: string;
  selectedFile: string;
  skillDetail?: SkillItem;
}

const ContentViewer = memo<ContentViewerProps>(
  ({ skillDetail, selectedFile, contentMap, liveContent }) => {
    if (selectedFile === 'SKILL.md') {
      const displayContent = liveContent ?? skillDetail?.content;
      if (!displayContent) {
        return (
          <div className={styles.docWrapper}>
            <p style={{ opacity: 0.45 }}>No content</p>
          </div>
        );
      }
      const { frontmatter, body } = parseFrontmatter(displayContent);
      return (
        <div className={styles.docWrapper}>
          {frontmatter && (
            <Highlighter fullFeatured language={'yaml'} variant={'outlined'}>
              {frontmatter}
            </Highlighter>
          )}
          <Markdown variant={'chat'}>{body}</Markdown>
        </div>
      );
    }

    const content = contentMap[selectedFile];

    if (isMarkdownFile(selectedFile)) {
      const { frontmatter, body } = parseFrontmatter(content);
      return (
        <div className={styles.docWrapper}>
          {frontmatter && (
            <Highlighter fullFeatured language={'yaml'} variant={'outlined'}>
              {frontmatter}
            </Highlighter>
          )}
          <Markdown variant={'chat'}>{body}</Markdown>
        </div>
      );
    }

    return (
      <div className={styles.codeWrapper}>
        <CopyButton
          content={content}
          style={{ position: 'absolute', right: 8, top: 0, zIndex: 1 }}
        />
        <Highlighter
          copyable={false}
          language={getLanguage(selectedFile)}
          showLanguage={false}
          variant={'borderless'}
        >
          {content}
        </Highlighter>
      </div>
    );
  },
);

ContentViewer.displayName = 'ContentViewer';

export default ContentViewer;
