import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { DeviceModel } from '@/database/models/device';
import { serverDB } from '@/database/server';

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const deviceModel = new DeviceModel(serverDB, session.user.id);
  const device = await deviceModel.findByDeviceId(code);
  if (!device) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  return NextResponse.json({ deviceId: device.deviceId, ok: true });
}
