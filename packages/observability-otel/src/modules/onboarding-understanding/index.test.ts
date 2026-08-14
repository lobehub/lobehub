import { describe, expect, it } from 'vitest';

import {
  ATTR_ONBOARDING_UNDERSTANDING_OPERATION,
  ATTR_ONBOARDING_UNDERSTANDING_PROVIDER,
  ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME,
  ATTR_ONBOARDING_UNDERSTANDING_SESSION_ID,
  ATTR_ONBOARDING_UNDERSTANDING_STATUS,
  ATTR_ONBOARDING_UNDERSTANDING_TOPIC_ID,
  buildOnboardingUnderstandingMetricAttributes,
  buildOnboardingUnderstandingProviderCollectionMetricAttributes,
  buildOnboardingUnderstandingProviderFailureMetricAttributes,
  buildOnboardingUnderstandingTraceAttributes,
} from './index';

/** @example describe('onboarding Understanding observability', () => {}); */
describe('onboarding Understanding observability', () => {
  /** @example expect(metricAttributes).not.toHaveProperty('session.id'); */
  it('keeps high-cardinality correlation identifiers out of metrics', () => {
    const attributes = buildOnboardingUnderstandingMetricAttributes(
      {
        operation: 'provider.collect',
        providerId: 'github',
        sessionId: 'session-1',
        topicId: 'topic-1',
      },
      'success',
    );

    /** @example expect(attributes).toEqual({ operation: 'provider.collect' }); */
    expect(attributes).toEqual({
      [ATTR_ONBOARDING_UNDERSTANDING_OPERATION]: 'provider.collect',
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: 'github',
      [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: 'success',
    });
  });

  /** @example expect(traceAttributes).toHaveProperty('session.id'); */
  it('keeps session and topic identifiers available for trace correlation', () => {
    const attributes = buildOnboardingUnderstandingTraceAttributes({
      operation: 'writer.process',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    /** @example expect(attributes).toEqual({ operation: 'writer.process' }); */
    expect(attributes).toEqual({
      [ATTR_ONBOARDING_UNDERSTANDING_OPERATION]: 'writer.process',
      [ATTR_ONBOARDING_UNDERSTANDING_SESSION_ID]: 'session-1',
      [ATTR_ONBOARDING_UNDERSTANDING_TOPIC_ID]: 'topic-1',
    });
  });

  /** @example expect(attributes).toEqual({ provider: 'gmail', outcome: 'failed' }); */
  it('records provider collection business outcomes without correlation identifiers', () => {
    const attributes = buildOnboardingUnderstandingProviderCollectionMetricAttributes(
      'gmail',
      'failed',
    );

    /** @example expect(attributes).not.toHaveProperty('session.id'); */
    expect(attributes).toEqual({
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: 'gmail',
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME]: 'failed',
    });
  });

  /** @example expect(attributes).toHaveProperty('failure.code', 'GMAIL_SEARCH_FAILED'); */
  it('builds a bounded provider failure reason label set', () => {
    const attributes = buildOnboardingUnderstandingProviderFailureMetricAttributes('gmail', {
      code: 'GMAIL_SEARCH_FAILED',
      operation: 'recent',
      retryable: true,
    });

    /** @example expect(attributes).not.toHaveProperty('error.message'); */
    expect(attributes).toEqual({
      'onboarding.understanding.failure.code': 'GMAIL_SEARCH_FAILED',
      'onboarding.understanding.failure.operation': 'recent',
      'onboarding.understanding.failure.retryable': true,
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: 'gmail',
    });
  });
});
