type ArtifactBoardOpener = (boardId: string) => void;

let opener: ArtifactBoardOpener | undefined;

/**
 * The board modal renders Canvas pages, so it needs the Canvas runtime that
 * only the main app bundles. Surfaces shared with builds that lack it (the
 * public share app renders the same message Work cards) open boards through
 * this indirection; the main app registers the real modal on start-up, and
 * elsewhere opening a board is a no-op.
 */
export const registerArtifactBoardOpener = (next: ArtifactBoardOpener) => {
  opener = next;
};

export const openArtifactBoard = (boardId: string) => opener?.(boardId);
