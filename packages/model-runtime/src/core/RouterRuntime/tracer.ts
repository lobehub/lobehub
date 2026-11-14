import { createTimingHelpers } from '../../utils/timing';

const { logger: timing } = createTimingHelpers('lobe-server:chat:lobehub:timing');

export type RouterTracer = (formatter: string, ...args: unknown[]) => void;

/** Only the hosted `lobehub` router emits request timing; other routers stay silent. */
export const createRouterTracer = (providerId: string): RouterTracer =>
  providerId === 'lobehub' ? (formatter, ...args) => timing(formatter, ...args) : () => {};
