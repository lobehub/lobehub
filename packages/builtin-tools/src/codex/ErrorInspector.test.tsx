/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ErrorInspector from './ErrorInspector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => 'Codex reported a warning',
  }),
}));

vi.mock('@lobechat/shared-tool-ui/styles', () => ({
  inspectorTextStyles: { root: 'inspector-root' },
  shinyTextStyles: { shinyText: 'shiny-text' },
}));

describe('Codex ErrorInspector', () => {
  afterEach(cleanup);

  it('renders the warning icon and error message', () => {
    const { container } = render(
      <ErrorInspector
        apiName="error"
        args={{ id: 'item_0', message: 'The session model changed.', type: 'error' }}
        identifier="codex"
      />,
    );

    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('The session model changed.')).toBeTruthy();
  });

  it('reads partial message content while arguments stream', () => {
    render(
      <ErrorInspector
        isArgumentsStreaming
        apiName="error"
        args={{}}
        identifier="codex"
        partialArgs={{ message: 'Session compatibility warning' }}
      />,
    );

    expect(screen.getByText('Session compatibility warning').classList).toContain('shiny-text');
  });

  it('uses localized fallback copy when no message is available', () => {
    render(<ErrorInspector apiName="error" args={{}} identifier="codex" />);

    expect(screen.getByText('Codex reported a warning')).toBeTruthy();
  });
});
