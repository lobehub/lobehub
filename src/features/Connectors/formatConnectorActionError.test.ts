import { createInstance, type TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import enUS from '../../../locales/en-US/tool.json';
import zhCN from '../../../locales/zh-CN/tool.json';
import {
  formatConnectorActionError,
  formatConnectorActionErrorToast,
} from './formatConnectorActionError';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${JSON.stringify(options)})` : key) as unknown as TFunction<'setting'>;

describe('formatConnectorActionErrorToast', () => {
  it.each([
    [
      'en-US',
      'Stdio connectors can only sync in the desktop app. Open LobeHub Desktop to sync this connector.',
    ],
    ['zh-CN', 'stdio 连接器只能在桌面端同步，请打开 LobeHub 桌面端同步此连接器。'],
  ])(
    'explains the desktop-only restriction in %s without raw diagnostics',
    async (lng, expected) => {
      const i18n = createInstance();
      await i18n.init({
        lng,
        resources: { 'en-US': { tool: enUS }, 'zh-CN': { tool: zhCN } },
      });
      const error = Object.assign(new Error('raw internal diagnostic'), {
        data: { code: 'BAD_REQUEST', errorData: { code: 'StdioDesktopOnly' } },
      });

      expect(formatConnectorActionErrorToast(i18n.getFixedT(lng, 'tool'), error)).toBe(expected);
    },
  );

  it('explains network failures for all detail-panel actions', () => {
    const translate = ((key: string) => key) as TFunction<'tool'>;
    expect(formatConnectorActionErrorToast(translate, new TypeError('Failed to fetch'))).toBe(
      'connector.error.network',
    );
  });

  it('does not interpret raw messages or unknown business codes as the stdio restriction', () => {
    const translate = ((key: string) => key) as TFunction<'tool'>;
    for (const error of [
      new Error('Stdio MCP type is not supported in web environment.'),
      { data: { code: 'INTERNAL_SERVER_ERROR', errorData: { code: 'OtherError' } } },
    ]) {
      expect(formatConnectorActionErrorToast(translate, error)).toBe('connector.actionFailed');
    }
  });
});

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
