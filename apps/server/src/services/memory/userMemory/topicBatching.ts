export const forEachBatchSequential = async <T>(
  items: T[],
  batchSize: number,
  handler: (batch: T[], batchIndex: number) => Promise<void>,
) => {
  if (batchSize <= 0) throw new Error('batchSize must be greater than 0');

  for (let start = 0, batchIndex = 0; start < items.length; start += batchSize, batchIndex += 1) {
    const batch = items.slice(start, start + batchSize);
    if (batch.length === 0) continue;
    // Sequential: wait for each batch before moving to the next
    await handler(batch, batchIndex);
  }
};
