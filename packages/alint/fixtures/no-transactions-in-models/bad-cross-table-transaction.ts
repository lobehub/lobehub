// Fixture: a Model whose bind() writes four tables inside one transaction.
import { and, eq } from 'drizzle-orm';

import { devices, directories, links, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class DirectoryModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async bind(deviceId: string, path: string) {
    // alint-expect
    return this.db.transaction(async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
      await tx.insert(links).values({ deviceId: device.id });
      const [directory] = await tx.insert(directories).values({ path }).returning();
      await tx
        .update(topics)
        .set({ directoryId: directory.id })
        .where(and(eq(topics.deviceId, device.id)));
      return directory;
    });
  }
}
