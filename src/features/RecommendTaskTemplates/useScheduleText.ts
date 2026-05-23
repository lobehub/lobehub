import { formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from '@lobechat/utils/cron';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Human-readable schedule line shared by the recommend card and detail modal. */
export const useScheduleText = (cronPattern: string): string => {
  const { t } = useTranslation('taskTemplate');
  const { t: tSetting } = useTranslation('setting');
  return useMemo(() => {
    const parsed = parseCronPattern(cronPattern);
    const time = formatScheduleTime(parsed.triggerHour, parsed.triggerMinute);
    if (parsed.scheduleType === 'weekly' && parsed.weekdays?.length === 1) {
      const weekday = tSetting(`agentCronJobs.weekday.${WEEKDAY_I18N_KEYS[parsed.weekdays[0]]}`);
      return t('schedule.weekly', { time, weekday });
    }
    return t('schedule.daily', { time });
  }, [t, tSetting, cronPattern]);
};
