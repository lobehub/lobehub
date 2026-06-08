import { createProcedureMarker, shouldSuppressByMarker } from '../marker';

describe('AgentSignalProcedureMarker', () => {
  /**
   * @example
   * shouldSuppressByMarker(marker, 150) === false
   */
  it('does not suppress when marker is missing, expired, accumulated, or suppressed-only', () => {
    const base = {
      createdAt: 100,
      domainKey: 'memory:user-preference',
      expiresAt: 120,
      procedureKey: 'message:m1',
      scopeKey: 'topic:t1',
    };

    expect(shouldSuppressByMarker(undefined, 150)).toBe(false);
    expect(
      shouldSuppressByMarker(createProcedureMarker({ ...base, markerType: 'handled' }), 150),
    ).toBe(false);
    expect(
      shouldSuppressByMarker(
        createProcedureMarker({ ...base, expiresAt: 200, markerType: 'accumulated' }),
        150,
      ),
    ).toBe(false);
    expect(
      shouldSuppressByMarker(
        createProcedureMarker({ ...base, expiresAt: 200, markerType: 'suppressed' }),
        150,
      ),
    ).toBe(false);
  });

  /**
   * @example
   * shouldSuppressByMarker(activeHandledMarker, 150) === true
   */
  it('suppresses only active handled markers', () => {
    const marker = createProcedureMarker({
      createdAt: 100,
      domainKey: 'memory:user-preference',
      expiresAt: 200,
      markerType: 'handled',
      procedureKey: 'message:m1',
      scopeKey: 'topic:t1',
    });

    expect(shouldSuppressByMarker(marker, 150)).toBe(true);
  });
});
