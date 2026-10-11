import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { describeError } from './errorMessage';
import { useEnvironmentActions } from './useEnvironmentData';

/**
 * Asks, then deletes an environment. Shared by the environment's row menu and
 * by its only copy in the Overview, where deleting the environment is how that
 * copy goes — the default copy is never deleted on its own.
 *
 * Asked for, like deleting a copy is: the environment carries its
 * specification, its variables and what its copy kept, and none of that comes
 * back.
 */
export const useConfirmRemoveEnvironment = () => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const { removeEnvironment } = useEnvironmentActions();

  return (environment: { id: string; name: string }) =>
    confirmModal({
      cancelText: tCommon('cancel'),
      content: t('environments.removeConfirmContent'),
      okButtonProps: { danger: true },
      okText: t('environments.remove'),
      // A refusal has to reach the person: an environment still holding other
      // copies is refused on purpose, and that is what they need to read.
      onOk: () =>
        removeEnvironment(environment.id).catch((error: unknown) =>
          toast.error(describeError(error, t, t('environments.removeFailed'))),
        ),
      title: t('environments.removeConfirmTitle', { name: environment.name }),
    });
};
