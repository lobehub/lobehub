import { NextResponse } from 'next/server';

import pkg from '../../../../../package.json';

export interface VersionResponseData {
  version: string;
}

export async function GET() {
  return NextResponse.json({
    version: pkg.version,
  } satisfies VersionResponseData);
}
