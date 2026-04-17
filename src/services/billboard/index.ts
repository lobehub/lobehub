import type { BillboardSet } from '@lobechat/edge-config';

class BillboardService {
  getActive = async (): Promise<BillboardSet | null> => {
    const res = await fetch('/webapi/billboards', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch billboards: ${res.status}`);
    }
    return res.json();
  };
}

export const billboardService = new BillboardService();
