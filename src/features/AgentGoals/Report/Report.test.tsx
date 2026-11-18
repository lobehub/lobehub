/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AcceptanceChecks from './AcceptanceChecks';
import DetourCallout from './DetourCallout';
import ReportChapters from './ReportChapters';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Markdown: ({ children }: { children: string }) => <div data-testid={'md'}>{children}</div>,
  };
});

describe('DetourCallout', () => {
  it('names the kind, the detour, why it strayed and what it taught', () => {
    render(
      <DetourCallout
        kind={'dead_end'}
        lesson={'Check the quota first'}
        reason={'The API rate-limited us'}
        title={'Bulk import'}
      />,
    );

    expect(screen.getByText('goalProcess.result.story.detourKind.dead_end')).toBeTruthy();
    expect(screen.getByText('Bulk import')).toBeTruthy();
    expect(screen.getByText('The API rate-limited us')).toBeTruthy();
    expect(screen.getByText(/Check the quota first/)).toBeTruthy();
  });
});

describe('ReportChapters', () => {
  const chapters = [
    {
      detours: [
        { kind: 'retry' as const, lesson: 'Retry later', reason: 'Flaky', title: 'Retry 1' },
      ],
      narrative: 'We started by **mapping** the problem.',
      title: 'Mapping',
    },
    { detours: [], narrative: 'Then we shipped.', title: 'Shipping' },
  ];

  it('renders each chapter in order with its narrative as markdown', () => {
    render(<ReportChapters chapters={chapters} />);

    const titles = screen.getAllByText(/^(Mapping|Shipping)$/).map((node) => node.textContent);
    expect(titles).toEqual(['Mapping', 'Shipping']);
    expect(screen.getAllByTestId('md').map((node) => node.textContent)).toEqual([
      'We started by **mapping** the problem.',
      'Then we shipped.',
    ]);
  });

  it('shows detours only on the chapters that took them, and links nowhere', () => {
    const { container } = render(<ReportChapters chapters={chapters} />);

    expect(screen.getAllByText('Retry 1')).toHaveLength(1);
    expect(container.querySelector('a, button')).toBeNull();
  });
});

describe('AcceptanceChecks', () => {
  it('shows every criterion with its verdict and the verifier reasoning', () => {
    render(
      <AcceptanceChecks
        checks={[
          { state: 'passed', summary: 'The page renders.', title: 'Page renders' },
          { state: 'failed', summary: 'Chart is blank.', title: 'Chart shows data' },
          { state: 'uncertain', title: 'Works offline' },
          { state: 'not_executed', summary: '   ', title: 'Exports PDF' },
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('goalShare.check.state.passed');
    expect(rows[1].textContent).toContain('goalShare.check.state.failed');
    expect(rows[2].textContent).toContain('goalShare.check.state.uncertain');
    expect(rows[3].textContent).toContain('goalShare.check.state.not_executed');
    expect(screen.getByText('Chart is blank.')).toBeTruthy();
    // A blank summary is not a reasoning block.
    expect(screen.getAllByTestId('md')).toHaveLength(2);
  });
});
