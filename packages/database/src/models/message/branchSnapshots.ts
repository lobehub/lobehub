import { isPlainRecord } from '@lobechat/utils/object';
import { and, asc, eq, inArray, not } from 'drizzle-orm';

import { messages } from '../../schemas';
import type { Transaction } from '../../type';
import { MessageScope } from './scope';

interface ActiveBranchSnapshot {
  activeBranchId?: string;
  activeBranchIndex: number;
  metadata: Record<PropertyKey, unknown>;
  parentId: string;
  wasOptimistic: boolean;
}

export class MessageBranchSnapshots extends MessageScope {
  /**
   * Preserve the selected branch by identity across a deletion. Branch metadata
   * stores a positional index, while deleting or reparenting children can change
   * that index space. If the selected branch itself is deleted, remove the stale
   * index so conversation-flow can infer the remaining active branch instead of
   * mistaking `index === branchCount` for an optimistic branch creation.
   */
  captureActiveBranchSnapshots = async (
    tx: Transaction,
    parentIds: string[],
  ): Promise<ActiveBranchSnapshot[]> => {
    const uniqueParentIds = [...new Set(parentIds)];
    if (uniqueParentIds.length === 0) return [];

    const parentRows = await tx
      .select({ id: messages.id, metadata: messages.metadata })
      .from(messages)
      .where(and(this.ownership(), inArray(messages.id, uniqueParentIds)));
    const branchIdsByParent = await this.queryDirectBranchIds(tx, uniqueParentIds);
    const snapshots: ActiveBranchSnapshot[] = [];

    for (const parent of parentRows) {
      if (!isPlainRecord(parent.metadata)) continue;

      const activeBranchIndex = parent.metadata.activeBranchIndex;
      if (typeof activeBranchIndex !== 'number' || activeBranchIndex < 0) continue;

      const branchIds = branchIdsByParent.get(parent.id) ?? [];
      snapshots.push({
        activeBranchId: branchIds[activeBranchIndex],
        activeBranchIndex,
        metadata: parent.metadata,
        parentId: parent.id,
        wasOptimistic: activeBranchIndex === branchIds.length,
      });
    }

    return snapshots;
  };

  private queryDirectBranchIds = async (tx: Transaction, parentIds: string[]) => {
    const branchRows = await tx
      .select({ id: messages.id, parentId: messages.parentId })
      .from(messages)
      .where(
        and(
          this.ownership(),
          inArray(messages.parentId, parentIds),
          not(eq(messages.role, 'tool')),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const branchIdsByParent = new Map<string, string[]>();

    for (const branch of branchRows) {
      /* v8 ignore next -- unreachable: `inArray(messages.parentId, …)` already excludes NULL parents */
      if (!branch.parentId) continue;
      const branchIds = branchIdsByParent.get(branch.parentId) ?? [];
      branchIds.push(branch.id);
      branchIdsByParent.set(branch.parentId, branchIds);
    }

    return branchIdsByParent;
  };

  reconcileActiveBranchSnapshots = async (tx: Transaction, snapshots: ActiveBranchSnapshot[]) => {
    if (snapshots.length === 0) return;

    const branchIdsByParent = await this.queryDirectBranchIds(
      tx,
      snapshots.map((snapshot) => snapshot.parentId),
    );

    for (const snapshot of snapshots) {
      const branchIds = branchIdsByParent.get(snapshot.parentId) ?? [];
      const survivingBranchIndex = snapshot.activeBranchId
        ? branchIds.indexOf(snapshot.activeBranchId)
        : -1;
      const activeBranchIndex = snapshot.wasOptimistic
        ? branchIds.length
        : survivingBranchIndex >= 0
          ? survivingBranchIndex
          : undefined;

      if (activeBranchIndex === snapshot.activeBranchIndex) continue;

      const metadata = { ...snapshot.metadata };
      delete metadata.activeBranchIndex;
      if (activeBranchIndex !== undefined) metadata.activeBranchIndex = activeBranchIndex;

      await tx
        .update(messages)
        .set({ metadata })
        .where(and(eq(messages.id, snapshot.parentId), this.ownership()));
    }
  };
}
