'use client';

import type { SkillItem } from '@lobechat/types';
import { Flexbox, Highlighter, Markdown } from '@lobehub/ui';
import { memo } from 'react';

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

interface ContentViewerProps {
  contentMap: Record<string, string>;
  selectedFile: string;
  skillDetail?: SkillItem;
}

const ContentViewer = memo<ContentViewerProps>(({ skillDetail, selectedFile, contentMap }) => {
  if (selectedFile === 'SKILL.md') {
    return (
      <Flexbox style={{ padding: '0 8px' }}>
        {skillDetail?.content ? (
          <Markdown variant={'chat'}>{skillDetail.content}</Markdown>
        ) : (
          <p style={{ opacity: 0.45 }}>No content</p>
        )}
      </Flexbox>
    );
  }

  const content = contentMap[selectedFile];

  if (content === undefined) {
    return <p style={{ opacity: 0.45, padding: 16 }}>Binary file not displayed</p>;
  }

  if (isMarkdownFile(selectedFile)) {
    return (
      <div style={{ padding: '0 8px' }}>
        <Markdown variant={'chat'}>{content}</Markdown>
      </div>
    );
  }

  return (
    <Highlighter language={getLanguage(selectedFile)} showLanguage={false} variant={'borderless'}>
      {content}
    </Highlighter>
  );
});

ContentViewer.displayName = 'ContentViewer';

export default ContentViewer;
