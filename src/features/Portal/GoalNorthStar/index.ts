import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useGoalNorthStarMoreMenu } from './useMoreMenu';

export const GoalNorthStar: PortalImpl = { Body, Title, useMoreMenu: useGoalNorthStarMoreMenu };
