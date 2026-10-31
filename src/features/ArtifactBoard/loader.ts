export const openArtifactBoardModal = async (boardId: string) => {
  const { createArtifactBoardModal } = await import('.');
  return createArtifactBoardModal(boardId);
};
