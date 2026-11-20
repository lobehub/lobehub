import type { MachinePaymentRecordParams } from './types';

/**
 * Records a settled machine payment.
 *
 * Open-source stub: no-op. Cloud overrides this to write the ledger row that
 * `/v1/usage` reads back.
 */
export async function recordPayment(_params: MachinePaymentRecordParams): Promise<void> {}
