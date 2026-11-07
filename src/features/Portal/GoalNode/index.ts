import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useGoalNodeMoreMenu } from './useMoreMenu';
import Wrapper from './Wrapper';

export const GoalNode: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useGoalNodeMoreMenu,
  Wrapper,
};
