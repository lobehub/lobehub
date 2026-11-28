import { TraeAcpAdapter } from './trae';

/** Maps Cursor's standard ACP session updates into the shared event protocol. */
export class CursorAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'cursor', provider: 'cursor' });
  }
}
