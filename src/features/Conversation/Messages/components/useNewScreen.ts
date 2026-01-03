import { useEffect, useState } from 'react';

export const useNewScreen = ({
  isLatestItem,
  creating,
}: {
  creating?: boolean;
  isLatestItem?: boolean;
}) => {
  const [newScreen, setNewScreen] = useState(false);
  useEffect(() => {
    if (!isLatestItem) setNewScreen(false);
    if (isLatestItem && creating) setNewScreen(true);
  }, [isLatestItem, creating]);
  return newScreen;
};
