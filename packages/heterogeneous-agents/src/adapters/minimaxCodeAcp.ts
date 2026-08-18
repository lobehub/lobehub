import { TraeAcpAdapter } from './traeAcp';

/** Maps MiniMax Code's standard ACP session updates into the shared event protocol. */
export class MinimaxCodeAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'minimax_code', provider: 'minimax-code' });
  }
}
