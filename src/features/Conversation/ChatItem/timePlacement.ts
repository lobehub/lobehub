interface TimePlacementInput {
  compact: boolean;
  hasHeaderAddon: boolean;
  isUser: boolean;
  showAvatar: boolean;
  showTitle: boolean;
}

export const shouldInlineTimeInActions = ({
  compact,
  hasHeaderAddon,
  isUser,
  showAvatar,
  showTitle,
}: TimePlacementInput) => compact && isUser && !showAvatar && !showTitle && !hasHeaderAddon;
