/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ResourceUnavailable, { type ResourceUnavailableVariant } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className} data-testid="resource-unavailable-shell">
      {children}
    </div>
  ),
  Icon: ({ size }: { icon: unknown; size?: number }) => (
    <span data-icon-size={size} data-testid="resource-unavailable-icon" />
  ),
}));

describe('ResourceUnavailable', () => {
  it('renders the shared unavailable label', () => {
    render(<ResourceUnavailable />);
    expect(screen.getByText('resourceUnavailable')).toBeTruthy();
  });

  it.each<ResourceUnavailableVariant>(['inline', 'attachment', 'card'])(
    'renders the same copy in %s variant (context supplies the type)',
    (variant) => {
      render(<ResourceUnavailable variant={variant} />);
      expect(screen.getByText('resourceUnavailable')).toBeTruthy();
    },
  );

  it('uses a smaller icon in inline variant', () => {
    render(<ResourceUnavailable variant="inline" />);
    const icon = screen.getByTestId('resource-unavailable-icon');
    expect(icon.getAttribute('data-icon-size')).toBe('12');
  });

  it('uses the larger icon in card variant', () => {
    render(<ResourceUnavailable variant="card" />);
    const icon = screen.getByTestId('resource-unavailable-icon');
    expect(icon.getAttribute('data-icon-size')).toBe('16');
  });
});
