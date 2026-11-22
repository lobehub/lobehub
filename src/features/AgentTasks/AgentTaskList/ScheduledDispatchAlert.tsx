import { SELF_HOSTING_DOCUMENTS } from '@lobechat/const';
import { Alert, Button } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const SETUP_DOCS = urlJoin(SELF_HOSTING_DOCUMENTS, '/environment-variables/basic#qstash_token');

/**
 * Cron-pattern tasks only start when something drives the schedule dispatcher.
 * When the server reports that nothing does, the Scheduled tab says so instead
 * of listing tasks that will silently never run. Not dismissible: the condition
 * holds until an administrator changes the deployment.
 */
export const ScheduledDispatchAlert = () => {
  const { t } = useTranslation('chat');
  // Absent until the server config resolves, so a loading page never flashes it.
  const dispatch = useServerConfigStore(serverConfigSelectors.scheduledTaskDispatch);

  if (dispatch !== 'unconfigured') return null;

  return (
    <Alert
      showIcon
      description={t('taskList.scheduled.dispatchUnavailable.desc')}
      title={t('taskList.scheduled.dispatchUnavailable.title')}
      type={'warning'}
      action={
        <Button href={SETUP_DOCS} size={'small'} target={'_blank'}>
          {t('taskList.scheduled.dispatchUnavailable.action')}
        </Button>
      }
    />
  );
};
