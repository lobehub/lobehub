import { INBOUND_WEBHOOK_ERRORS, type InboundWebhookError } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { automationErrorKey, isAutomationHealthy, resolveAutomationStatus } from './status';

describe('resolveAutomationStatus', () => {
  it('reads an active row without errors as healthy, with nothing to do', () => {
    expect(resolveAutomationStatus({ lastError: null, status: 'active' })).toEqual({
      kind: 'active',
      labelKey: 'automations.status.active',
      remedy: 'none',
      tone: 'success',
    });
  });

  it('keeps an active row active and warns about a skipped run', () => {
    expect(resolveAutomationStatus({ lastError: 'wake_cap', status: 'active' })).toMatchObject({
      kind: 'active',
      reasonKey: 'automations.error.wake_cap',
      reasonTone: 'warning',
      remedy: 'none',
      tone: 'success',
    });
  });

  it('asks to reconnect when the connector credentials stopped working', () => {
    expect(resolveAutomationStatus({ lastError: 'auth', status: 'error' })).toMatchObject({
      kind: 'reconnect',
      labelKey: 'automations.status.reconnect',
      reasonKey: 'automations.error.auth',
      remedy: 'reconnect',
      tone: 'error',
    });
  });

  it.each<InboundWebhookError>([
    'connection_refused',
    'timeout',
    'tls_error',
    'http_4xx',
    'http_5xx',
    'challenge_failed',
    'delivery_suspended',
    'server_unreachable',
    'unknown',
  ])('points a %s delivery error at the check button', (lastError) => {
    expect(resolveAutomationStatus({ lastError, status: 'error' })).toMatchObject({
      kind: 'deliveryError',
      labelKey: 'automations.status.deliveryError',
      reasonKey: `automations.error.${lastError}`,
      remedy: 'check',
      tone: 'error',
    });
  });

  it('does not offer a check for errors a check cannot fix', () => {
    expect(
      resolveAutomationStatus({ lastError: 'insufficient_budget', status: 'error' }).remedy,
    ).toBe('none');
    expect(resolveAutomationStatus({ lastError: 'wake_cap', status: 'error' }).remedy).toBe('none');
  });

  it('reads an error row without a recorded cause as unknown', () => {
    expect(resolveAutomationStatus({ lastError: null, status: 'error' })).toMatchObject({
      reasonKey: 'automations.error.unknown',
      remedy: 'check',
    });
  });

  it('marks a terminated row and asks for a new subscription', () => {
    expect(
      resolveAutomationStatus({ lastError: 'access_revoked', status: 'terminated' }),
    ).toMatchObject({
      kind: 'terminated',
      labelKey: 'automations.status.terminated',
      reasonKey: 'automations.error.access_revoked',
      remedy: 'resubscribe',
      tone: 'default',
    });
    expect(resolveAutomationStatus({ lastError: null, status: 'terminated' }).reasonKey).toBe(
      'automations.error.terminated',
    );
  });
});

describe('automationErrorKey', () => {
  it('has its own reason for every last_error value in the contract', () => {
    const keys = INBOUND_WEBHOOK_ERRORS.map((error) => automationErrorKey(error));

    expect(new Set(keys).size).toBe(INBOUND_WEBHOOK_ERRORS.length);
    for (const error of INBOUND_WEBHOOK_ERRORS)
      expect(automationErrorKey(error)).toBe(`automations.error.${error}`);
  });

  it('falls back to unknown for a value the client does not know yet', () => {
    expect(automationErrorKey('rate_limited')).toBe('automations.error.unknown');
  });
});

describe('isAutomationHealthy', () => {
  it('is true only for an active row without errors', () => {
    expect(isAutomationHealthy({ lastError: null, status: 'active' })).toBe(true);
    expect(isAutomationHealthy({ lastError: 'wake_cap', status: 'active' })).toBe(false);
    expect(isAutomationHealthy({ lastError: null, status: 'error' })).toBe(false);
  });
});
