export const isCompressionSummaryGenerating = (operationType?: string) =>
  operationType === 'generateSummary' || operationType === 'contextCompression';

export const shouldShowCompressedGroupPanel = ({
  expanded,
  isGeneratingSummary,
}: {
  expanded: boolean;
  isGeneratingSummary: boolean;
}) => expanded && !isGeneratingSummary;
