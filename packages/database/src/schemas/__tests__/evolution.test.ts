// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { evolutionNodes, evolutionTrees, users } from '..';

const serverDB = await getTestDB();
const userId = 'evolution-schema-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

const createTree = async () => {
  const [tree] = await serverDB
    .insert(evolutionTrees)
    .values({
      objective: 'Evolve an oscillatory-integral solver',
      scorer: { command: 'python eval.py' },
      subjectType: 'standalone',
      title: 'Integral solver search',
      userId,
    })
    .returning();
  return tree;
};

describe('evolution schema', () => {
  it('generates prefixed tree ids with pending defaults', async () => {
    const tree = await createTree();

    expect(tree.id).toMatch(/^evo_/);
    expect(tree.status).toBe('pending');
    expect(tree.scorer).toEqual({ command: 'python eval.py' });
  });

  it('keeps one seq per tree and reads scores back as numbers', async () => {
    const tree = await createTree();
    const [root] = await serverDB
      .insert(evolutionNodes)
      .values({ content: 'v1', score: -3.4, seq: 1, status: 'scored', treeId: tree.id, userId })
      .returning();

    expect(root.score).toBe(-3.4);
    expect(root.visits).toBe(0);

    await expect(
      serverDB.insert(evolutionNodes).values({ content: 'dupe', seq: 1, treeId: tree.id, userId }),
    ).rejects.toThrow();
  });

  it('cascades a branch through the parent link and the whole tree through treeId', async () => {
    const tree = await createTree();
    const [root] = await serverDB
      .insert(evolutionNodes)
      .values({ content: 'v1', seq: 1, treeId: tree.id, userId })
      .returning();
    const [child] = await serverDB
      .insert(evolutionNodes)
      .values({ content: 'v2', parentId: root.id, seq: 2, treeId: tree.id, userId })
      .returning();
    await serverDB
      .insert(evolutionNodes)
      .values({ content: 'v3', parentId: child.id, seq: 3, treeId: tree.id, userId });
    // A failed run enters the tree too — the search learns from dead ends.
    await serverDB.insert(evolutionNodes).values({
      content: 'v4',
      error: 'sandbox timeout',
      parentId: root.id,
      seq: 4,
      status: 'failed',
      treeId: tree.id,
      userId,
    });

    // Pruning the child branch removes its descendants, not its siblings.
    await serverDB.delete(evolutionNodes).where(eq(evolutionNodes.id, child.id));
    const afterPrune = await serverDB
      .select()
      .from(evolutionNodes)
      .where(eq(evolutionNodes.treeId, tree.id));
    expect(afterPrune.map((n) => n.seq).sort()).toEqual([1, 4]);

    await serverDB.delete(evolutionTrees).where(eq(evolutionTrees.id, tree.id));
    expect(
      await serverDB.select().from(evolutionNodes).where(eq(evolutionNodes.treeId, tree.id)),
    ).toHaveLength(0);
  });
});
