import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATTR_ONBOARDING_UNDERSTANDING_FAILURE_MESSAGE,
  ATTR_ONBOARDING_UNDERSTANDING_OPERATION,
  ATTR_ONBOARDING_UNDERSTANDING_PROVIDER,
  ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME,
  ATTR_ONBOARDING_UNDERSTANDING_SESSION_ID,
  ATTR_ONBOARDING_UNDERSTANDING_STATUS,
  ATTR_ONBOARDING_UNDERSTANDING_TOPIC_ID,
  buildOnboardingUnderstandingMetricAttributes,
  buildOnboardingUnderstandingProviderCollectionMetricAttributes,
  buildOnboardingUnderstandingProviderFailureMetricAttributes,
  buildOnboardingUnderstandingProviderFailureTraceAttributes,
  buildOnboardingUnderstandingTraceAttributes,
  getOnboardingUnderstandingProviderCollectionStatus,
  observeOnboardingUnderstandingProviderCollection,
  operationCounter,
} from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  /** @example expect(status).toBe('failed'); */
  it('records returned partial and failed provider collections as business failures', () => {
    const partialStatus = getOnboardingUnderstandingProviderCollectionStatus('partial');
    const failedStatus = getOnboardingUnderstandingProviderCollectionStatus('failed');
    const completedStatus = getOnboardingUnderstandingProviderCollectionStatus('completed');

    /** @example expect(partialStatus).toBe('failed'); */
    expect(partialStatus).toBe('failed');
    /** @example expect(failedStatus).toBe('failed'); */
    expect(failedStatus).toBe('failed');
    /** @example expect(completedStatus).toBe('success'); */
    expect(completedStatus).toBe('success');
  });

  /** @example expect(operationCounter.add).toHaveBeenCalledWith(1, { status: 'failed' }); */
  it('records a normally returned failed collection as failed instead of success or error', async () => {
    // ROOT CAUSE:
    //
    // The observer initialized operationStatus to success and changed it only when the callback
    // threw. A provider could return outcome=failed without throwing, so the generic operation
    // counter incorrectly reported a successful provider.collect operation.
    //
    // Before: outcome=failed -> onboarding.understanding.status=success.
    //
    // We fixed this by mapping returned partial/failed outcomes to the distinct business status
    // failed while reserving error for thrown exceptions.
    const add = vi.spyOn(operationCounter, 'add');

    const result = await observeOnboardingUnderstandingProviderCollection(
      { providerId: 'gmail', sessionId: 'session-1', topicId: 'topic-1' },
      async () => ({
        diagnostics: [
          {
            code: 'GMAIL_READ_PERMISSION_REQUIRED',
            message: 'Gmail read permission is missing',
            operation: 'permission',
            retryable: false,
          },
        ],
        evidenceCount: 0,
        failedCount: 1,
        outcome: 'failed',
        result: 'failed-result',
        sourceCount: 0,
        succeededCount: 0,
      }),
    );

    /** @example expect(result).toBe('failed-result'); */
    expect(result).toBe('failed-result');
    /** @example expect(add).toHaveBeenCalledWith(1, { status: 'failed' }); */
    expect(add).toHaveBeenCalledWith(1, {
      [ATTR_ONBOARDING_UNDERSTANDING_OPERATION]: 'provider.collect',
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: 'gmail',
      [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: 'failed',
    });
  });

  /** @example expect(attributes).toHaveProperty('failure.code', 'GMAIL_SEARCH_FAILED'); */
  it('builds a bounded provider failure reason label set', () => {
    const attributes = buildOnboardingUnderstandingProviderFailureMetricAttributes('gmail', {
      code: 'GMAIL_SEARCH_FAILED',
      message: 'Composio rejected the Gmail search request',
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

  /** @example expect(attributes).toHaveProperty('failure.message', upstreamMessage); */
  it('retains provider failure messages only on trace-event attributes', () => {
    const upstreamMessage = 'GraphQL FORBIDDEN at viewer.repository(name: profile)';
    const attributes = buildOnboardingUnderstandingProviderFailureTraceAttributes('github', {
      code: 'GITHUB_PROFILE_README_FAILED',
      message: upstreamMessage,
      operation: 'profileReadme',
      retryable: false,
    });

    /** @example expect(attributes[ATTR_FAILURE_MESSAGE]).toBe(upstreamMessage); */
    expect(attributes).toEqual({
      'onboarding.understanding.failure.code': 'GITHUB_PROFILE_README_FAILED',
      [ATTR_ONBOARDING_UNDERSTANDING_FAILURE_MESSAGE]: upstreamMessage,
      'onboarding.understanding.failure.operation': 'profileReadme',
      'onboarding.understanding.failure.retryable': false,
      [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: 'github',
    });
  });
});
