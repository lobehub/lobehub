import { NextResponse } from 'next/server';

import { isKeyVaultsSecretBearerToken } from '@/server/modules/KeyVaultsEncrypt';
import { GatewayService } from '@/server/services/gateway';

export const POST = async (req: Request): Promise<Response> => {
  const authHeader = req.headers.get('authorization');
  if (!isKeyVaultsSecretBearerToken(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const service = new GatewayService();

  try {
    if (body.restart) {
      console.info('[GatewayService] Restarting...');
      await service.stop();
    }

    await service.ensureRunning();
    console.info('[GatewayService] Started successfully');

    return NextResponse.json({ status: body.restart ? 'restarted' : 'started' });
  } catch (error) {
    console.error('[GatewayService] Failed to start:', error);
    return NextResponse.json({ error: 'Failed to start gateway' }, { status: 500 });
  }
};
