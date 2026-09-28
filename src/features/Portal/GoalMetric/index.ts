import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useGoalMetricMoreMenu } from './useMoreMenu';

export const GoalMetric: PortalImpl = { Body, Title, useMoreMenu: useGoalMetricMoreMenu };
