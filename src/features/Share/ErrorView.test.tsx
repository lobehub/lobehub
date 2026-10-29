import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ShareErrorView from './ErrorView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/404', () => ({
  default: ({ desc, title }: { desc: string; title: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{desc}</p>
    </div>
  ),
}));

describe('ShareErrorView', () => {
  it('names a missing share with the topic copy by default', () => {
    render(<ShareErrorView error={new Error('missing')} />);

    expect(screen.getByText('sharePage.error.notFound.title')).toBeInTheDocument();
  });

  // Regression: a broken file share link reported "Topic Not Found".
  it('uses the page-specific copy for a missing share when given', () => {
    render(
      <ShareErrorView
        error={new Error('missing')}
        notFound={{ desc: 'File gone', title: 'File Not Found' }}
      />,
    );

    expect(screen.getByText('File Not Found')).toBeInTheDocument();
    expect(screen.getByText('File gone')).toBeInTheDocument();
    expect(screen.queryByText('sharePage.error.notFound.title')).toBeNull();
  });
});
