import type {
  artboardBoards,
  artboardComments,
  artboardEdges,
  artboardGroups,
  artboardPages,
  artboardRounds,
  artboards,
} from '../../schemas/artboard';

export type ArtboardRow = typeof artboards.$inferSelect;
export type ArtboardPageRow = typeof artboardPages.$inferSelect;
export type NewArtboardPageRow = typeof artboardPages.$inferInsert;
export type ArtboardRoundRow = typeof artboardRounds.$inferSelect;
export type NewArtboardRoundRow = typeof artboardRounds.$inferInsert;
export type ArtboardGroupRow = typeof artboardGroups.$inferSelect;
export type NewArtboardGroupRow = typeof artboardGroups.$inferInsert;
export type ArtboardBoardRow = typeof artboardBoards.$inferSelect;
export type NewArtboardBoardRow = typeof artboardBoards.$inferInsert;
export type ArtboardEdgeRow = typeof artboardEdges.$inferSelect;
export type NewArtboardEdgeRow = typeof artboardEdges.$inferInsert;
export type ArtboardCommentRow = typeof artboardComments.$inferSelect;
export type NewArtboardCommentRow = typeof artboardComments.$inferInsert;
