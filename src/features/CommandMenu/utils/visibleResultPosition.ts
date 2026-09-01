export const createVisibleResultPositionMap = <T>(groups: T[][], offset = 0) => {
  const positions = new Map<T, number>();
  let position = offset;

  for (const group of groups) {
    for (const result of group) {
      positions.set(result, ++position);
    }
  }

  return positions;
};
