import { Flexbox, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import * as motion from 'motion/react-m';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors } from '@/store/tool/selectors';
import { MCPInstallStep } from '@/types/plugins';

import InstallError from './InstallError';
import MCPConfigForm from './MCPConfigForm';
import MCPDependenciesGuide from './MCPDependenciesGuide';

const MCPInstallProgress = memo<{ identifier: string }>(({ identifier }) => {
  const { t } = useTranslation('plugin');
  const installProgress = useToolStore(
    mcpStoreSelectors.getMCPInstallProgress(identifier),
    isEqual,
  );

  const stepText = installProgress ? t(`mcpInstall.${installProgress.step}` as any) : undefined;
  const needsConfig = installProgress?.needsConfig;
  const needsDependencies = installProgress?.step === MCPInstallStep.DEPENDENCIES_REQUIRED;
  const hasError = installProgress?.step === MCPInstallStep.ERROR;
  const errorInfo = installProgress?.errorInfo;

  return (
    <>
      {installProgress && !hasError && !needsDependencies && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.4, 0, 0.2, 1],
            height: { duration: 0.2 },
          }}
        >
          <Flexbox paddingBlock={4}>
            <Progress
              percent={installProgress.progress}
              showInfo={false}
              size="small"
              status="active"
              strokeColor={{ '0%': cssVar.blue, '100%': cssVar.geekblue }}
            />
            {stepText && (
              <Text fontSize={11} style={{ marginTop: 4 }} type={'secondary'}>
                ({installProgress.progress}%) {stepText}
              </Text>
            )}
          </Flexbox>
        </motion.div>
      )}

      {hasError && errorInfo && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.4, 0, 0.2, 1],
            height: { duration: 0.2 },
          }}
        >
          <Flexbox paddingBlock={8}>
            <InstallError errorInfo={errorInfo} identifier={identifier} />
          </Flexbox>
        </motion.div>
      )}

      {needsDependencies && installProgress?.systemDependencies && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.4, 0, 0.2, 1],
            height: { duration: 0.2 },
          }}
        >
          <Flexbox paddingInline={12}>
            <MCPDependenciesGuide
              identifier={identifier}
              systemDependencies={installProgress.systemDependencies}
            />
          </Flexbox>
        </motion.div>
      )}

      {needsConfig && installProgress && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.4, 0, 0.2, 1],
            height: { duration: 0.2 },
          }}
        >
          <MCPConfigForm configSchema={installProgress.configSchema} identifier={identifier} />
        </motion.div>
      )}
    </>
  );
});

export default MCPInstallProgress;
