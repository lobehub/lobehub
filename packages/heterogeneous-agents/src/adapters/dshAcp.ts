import { TraeAcpAdapter } from './traeAcp';

/**
 * Maps DeepSeek Harness's standard ACP session updates into the shared event
 * protocol. Its `usage_update` reports context occupancy only, so no per-turn
 * token usage crosses.
 */
export class DshAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'dsh', provider: 'deepseek-harness' });
  }
}
