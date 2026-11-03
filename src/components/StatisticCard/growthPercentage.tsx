export const calcGrowthPercentage = (currentCount: number, previousCount: number) => {
  if (typeof currentCount !== 'number') return 0;
  return previousCount !== 0
    ? ((currentCount - previousCount) / previousCount) * 100 // Calculate growth percentage
    : currentCount > 0
      ? 100
      : 0;
};
