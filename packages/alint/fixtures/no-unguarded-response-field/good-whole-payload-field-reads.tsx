import type { AgentRunBoardData } from '@lobechat/types';

import { buildHourCells } from './layout';

// The prop is a whole named payload, so nothing read from it is marked as a response.
export const Calendar = ({ board }: { board: AgentRunBoardData }) => {
  const cells = buildHourCells(board.lanes, board.generatedAt);

  return <div>{cells.length}</div>;
};

export const Timeline = ({ board }: { board: AgentRunBoardData }) => {
  const { hiddenLaneCount, lanes } = board;

  return (
    <div>
      {lanes.map((lane) => (
        <span key={lane.agentId}>{lane.title}</span>
      ))}
      {board.attention.length + hiddenLaneCount}
    </div>
  );
};
