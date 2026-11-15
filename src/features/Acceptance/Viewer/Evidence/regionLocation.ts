interface RegionRef {
  evidenceId: string;
  key: number;
}

export interface RegionLocation {
  image: number;
  region: number;
}

export const regionLocations = (
  annotations: RegionRef[],
  evidenceIds: string[],
): RegionLocation[] => {
  const drawnPerImage = new Map<string, number>();
  return annotations.map((annotation) => {
    const region = (drawnPerImage.get(annotation.evidenceId) ?? 0) + 1;
    drawnPerImage.set(annotation.evidenceId, region);
    return { image: evidenceIds.indexOf(annotation.evidenceId) + 1, region };
  });
};
