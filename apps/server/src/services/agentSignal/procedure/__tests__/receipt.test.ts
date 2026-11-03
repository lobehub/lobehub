import { mergeMessageReceiptEnvelope, renderProcedureReceiptContext } from '../receipt';

describe('AgentSignalProcedureReceipt', () => {
  /**
   * @example
   * mergeMessageReceiptEnvelope({ existing: true }, envelope).existing === true
   */
  it('merges message metadata without overwriting unrelated fields', () => {
    expect(
      mergeMessageReceiptEnvelope(
        { agentSignalReceipts: [{ domainKey: 'memory', id: 'old' }], existing: true },
        {
          domainKey: 'memory',
          id: 'new',
          status: 'handled',
          summary: 'Saved preference.',
          updatedAt: 200,
        },
      ),
    ).toEqual({
      agentSignalReceipts: [
        { domainKey: 'memory', id: 'old' },
        {
          domainKey: 'memory',
          id: 'new',
          status: 'handled',
          summary: 'Saved preference.',
          updatedAt: 200,
        },
      ],
      existing: true,
    });
  });

  /**
   * @example
   * renderProcedureReceiptContext(receipts).includes('memory')
   */
  it('renders compact context without exposing internal receipt ids', () => {
    expect(
      renderProcedureReceiptContext([
        {
          createdAt: 100,
          domainKey: 'memory:user-preference',
          id: 'receipt_internal',
          scopeKey: 'topic:t1',
          status: 'handled',
          summary: '已记录偏好：默认简洁回答。',
          updatedAt: 100,
        },
      ]),
    ).toBe('Recent Agent Signal updates:\n- memory: 已记录偏好：默认简洁回答。');
  });
});
