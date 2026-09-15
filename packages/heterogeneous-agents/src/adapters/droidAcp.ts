import { TraeAcpAdapter } from './traeAcp';

/** Maps Factory Droid's standard ACP session updates into the shared event protocol. */
export class DroidAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'droid', provider: 'droid' });
  }
}
