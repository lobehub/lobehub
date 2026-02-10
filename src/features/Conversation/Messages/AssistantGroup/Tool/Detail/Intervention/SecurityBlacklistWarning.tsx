import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import { Alert, Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface SecurityBlacklistWarningProps {
  args: Record<string, any>;
}

const SecurityBlacklistWarning = memo<SecurityBlacklistWarningProps>(({ args }) => {
  const { t } = useTranslation('tool');

  const securityCheck = useMemo(
    () => InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, args),
    [args],
  );

  if (!securityCheck.blocked) return null;

  return (
    <Alert
      showIcon
      title={t('localFiles.securityBlacklist.warning')}
      type="error"
      variant="borderless"
      description={
        <Flexbox gap={4} style={{ fontSize: 12 }}>
          <div>{securityCheck.reason ? t(securityCheck.reason as any) : undefined}</div>
        </Flexbox>
      }
    />
  );
});

SecurityBlacklistWarning.displayName = 'SecurityBlacklistWarning';

export default SecurityBlacklistWarning;
