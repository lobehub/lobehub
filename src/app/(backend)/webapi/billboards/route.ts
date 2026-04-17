import type { BillboardSet } from '@lobechat/edge-config';
import { EdgeConfig } from '@lobechat/edge-config';
import { NextResponse } from 'next/server';

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
};

export const GET = async () => {
  if (!EdgeConfig.isEnabled()) {
    return NextResponse.json(null, { headers: CACHE_HEADERS });
  }

  try {
    const billboard: BillboardSet | null | undefined = await new EdgeConfig().getBillboards();

    if (!billboard) {
      return NextResponse.json(null, { headers: CACHE_HEADERS });
    }

    // 按 now 过滤时间窗口
    const now = Date.now();
    const start = Date.parse(billboard.startAt);
    const end = Date.parse(billboard.endAt);
    const inWindow = Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;

    return NextResponse.json(inWindow ? billboard : null, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[billboards] failed to read EdgeConfig:', err);
    return NextResponse.json(null, {
      headers: { 'Cache-Control': 'public, s-maxage=10' },
    });
  }
};
