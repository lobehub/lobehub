export const shouldShowSharedAgentLoader = ({
  hasData,
  isLoading,
}: {
  hasData: boolean;
  isLoading: boolean;
}) => isLoading && !hasData;
