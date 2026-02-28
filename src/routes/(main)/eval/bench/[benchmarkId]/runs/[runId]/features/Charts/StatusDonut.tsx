'use client';

import { DonutChart } from '@lobehub/charts';
import { useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface StatusDonutProps {
  errorCases: number;
  failedCases: number;
  passedCases: number;
}

const StatusDonut = memo<StatusDonutProps>(({ passedCases, failedCases, errorCases }) => {
  const { t } = useTranslation('eval');
  const theme = useTheme();

  const data = [
    { name: t('run.chart.pass'), value: passedCases },
    { name: t('run.chart.fail'), value: failedCases },
    ...(errorCases > 0 ? [{ name: t('run.chart.error'), value: errorCases }] : []),
  ];

  const colors = [
    theme.colorSuccess,
    theme.colorFill,
    ...(errorCases > 0 ? [theme.colorWarning] : []),
  ];

  return (
    <DonutChart
      category="value"
      colors={colors}
      data={data}
      index="name"
      style={{ height: 200 }}
      variant="pie"
    />
  );
});

export default StatusDonut;
