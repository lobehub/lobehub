import { type TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { formatConnectorActionError } from './formatConnectorActionError';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${JSON.stringify(options)})` : key) as unknown as TFunction<'setting'>;

describe('formatConnectorActionError', () => {
  it('explains a permission rejection of a connect', () => {
    expect(formatConnectorActionError(t, { action: 'connect', code: 'FORBIDDEN' }, 'Gmail')).toBe(
      'tools.connectorFeedback.connectFailed({"reason":"tools.connectorFeedback.reason.forbidden"})',
    );
  });

  it('explains a dropped remove and keeps the connector-still-here wording', () => {
    expect(formatConnectorActionError(t, { action: 'remove', code: 'NETWORK' }, 'Gmail')).toBe(
      'tools.connectorFeedback.removeFailed({"reason":"tools.connectorFeedback.reason.network"})',
    );
  });

  it('does not invite a retry when a removal is forbidden', () => {
    expect(formatConnectorActionError(t, { action: 'remove', code: 'FORBIDDEN' }, 'Gmail')).toBe(
      'tools.connectorFeedback.removeFailedFinal({"reason":"tools.connectorFeedback.reason.forbidden"})',
    );
  });

  it('names the app when the OAuth window closed without access', () => {
    expect(
      formatConnectorActionError(t, { action: 'connect', code: 'AUTH_INCOMPLETE' }, 'Gmail'),
    ).toContain('reason.authIncomplete({\\"name\\":\\"Gmail\\"})');
  });

  it('shows an actionable BAD_REQUEST message as-is', () => {
    expect(
      formatConnectorActionError(
        t,
        { action: 'connect', code: 'BAD_REQUEST', message: 'Provide an OAuth Client ID' },
        'Gmail',
      ),
    ).toBe('tools.connectorFeedback.connectFailed({"reason":"Provide an OAuth Client ID"})');
  });

  it('hides raw upstream output behind a generic reason', () => {
    expect(
      formatConnectorActionError(
        t,
        { action: 'connect', code: 'INTERNAL_SERVER_ERROR', message: '401 {"error":{}}' },
        'Gmail',
      ),
    ).toBe(
      'tools.connectorFeedback.connectFailed({"reason":"tools.connectorFeedback.reason.unknown"})',
    );
  });
});
