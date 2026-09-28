import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useGoalNodeMoreMenu } from './useMoreMenu';

export const GoalNode: PortalImpl = { Body, Title, useMoreMenu: useGoalNodeMoreMenu };
