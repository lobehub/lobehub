import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PageSelections from './PageSelections';

describe('PageSelections', () => {
  it('renders code selections with file line metadata and code content', () => {
    render(
      <PageSelections
        selections={[
          {
            content: 'const answer = 42;',
            filePath: 'src/example.ts',
            id: 'selection-1',
            lineRange: { endLine: 7, startLine: 7 },
            source: 'code',
          },
        ]}
      />,
    );

    expect(screen.getByText('src/example.ts:7-7')).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
  });

  it('keeps text selections in quote style without synthetic metadata', () => {
    render(
      <PageSelections
        selections={[
          {
            content: 'selected paragraph',
            id: 'selection-1',
            pageId: 'page-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('selected paragraph')).toBeInTheDocument();
    expect(screen.queryByText('page-1')).not.toBeInTheDocument();
  });

  it('renders file selections with the file name, page and quoted text', () => {
    render(
      <PageSelections
        selections={[
          {
            content: 'Table 2: ablation results',
            fileId: 'file_abc',
            id: 'selection-1',
            pageRange: { startPage: 3 },
            source: 'file',
            title: 'paper.pdf',
          },
        ]}
      />,
    );

    expect(screen.getByText('paper.pdf · contextSelection.file.page')).toBeInTheDocument();
    expect(screen.getByText('Table 2: ablation results')).toBeInTheDocument();
  });
});
