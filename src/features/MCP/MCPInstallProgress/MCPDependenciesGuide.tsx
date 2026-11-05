import { Block, Button, Flexbox, Markdown, Snippet, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle, CheckCircle, ExternalLink, Terminal } from 'lucide-react';
import * as m from 'motion/react-m';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { type SystemDependencyCheckResult } from '@/types/plugins';

interface MCPDependenciesGuideProps {
  identifier: string;
  systemDependencies: SystemDependencyCheckResult[];
}

const styles = stylex.create({
  container: {
    marginBlockStart: cssVar.marginXS,
    padding: cssVar.padding,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
  },
  dependencyCard: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusSM,
  },
  footer: {
    display: 'flex',
    gap: cssVar.marginXS,
    justifyContent: 'flex-end',
    marginBlockStart: cssVar.marginXS,
  },
  statusIcon: { display: 'flex', gap: cssVar.marginXXS, alignItems: 'center' },
});

const MCPDependenciesGuide = memo<MCPDependenciesGuideProps>(
  ({ identifier, systemDependencies }) => {
    const { t } = useTranslation(['plugin', 'common']);
    const [installMCPPlugin, cancelInstallMCPPlugin] = useToolStore((s) => [
      s.installMCPPlugin,
      s.cancelInstallMCPPlugin,
    ]);

    const handleCancel = () => {
      cancelInstallMCPPlugin(identifier);
    };

    const handleRetryCheck = async () => {
      // Re-check dependencies, restart the installation process
      await installMCPPlugin(identifier);
    };

    const handleSkipCheck = async () => {
      // Skip dependency check, continue installation process
      await installMCPPlugin(identifier, { skipDepsCheck: true });
    };

    return (
      <m.div
        animate={{ y: 0 }}
        {...stylex.props(styles.container)}
        initial={{ y: 8 }}
        transition={{ delay: 0.1, duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <m.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 4 }}
          style={{ marginBottom: 8 }}
          transition={{ delay: 0.15, duration: 0.2 }}
        >
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8}>
              <AlertTriangle color={cssVar.colorWarning} size={16} />
              <Text as={'h5'} style={{ margin: 0 }}>
                {t('mcpInstall.dependenciesRequired')}
              </Text>
            </Flexbox>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('mcpInstall.dependenciesDescription')}
            </Text>
          </Flexbox>
        </m.div>

        <m.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 4 }}
          transition={{ delay: 0.2, duration: 0.2 }}
        >
          <Flexbox gap={8}>
            {systemDependencies.map((dep) => (
              <Block
                className={stylex.props(styles.dependencyCard).className}
                key={dep.name}
                padding={12}
                variant={'outlined'}
              >
                <Flexbox gap={12}>
                  <Flexbox horizontal align="center" justify="space-between">
                    <Flexbox horizontal align="center" gap={8}>
                      <Text strong>{dep.name}</Text>
                      {dep.requiredVersion && (
                        <Text style={{ fontSize: 12 }} type="secondary">
                          {t('mcpInstall.dependencyStatus.requiredVersion', {
                            version: dep.requiredVersion,
                          })}
                        </Text>
                      )}
                    </Flexbox>
                    <div {...stylex.props(styles.statusIcon)}>
                      {dep.meetRequirement ? (
                        <>
                          <CheckCircle color={cssVar.colorSuccess} size={14} />
                          <Text style={{ fontSize: 12 }} type="success">
                            {t('mcpInstall.dependencyStatus.installed')}
                          </Text>
                        </>
                      ) : (
                        <>
                          <AlertTriangle color={cssVar.colorWarning} size={14} />
                          <Text style={{ fontSize: 12 }} type="warning">
                            {t('mcpInstall.dependencyStatus.notInstalled')}
                          </Text>
                        </>
                      )}
                    </div>
                  </Flexbox>

                  {!dep.meetRequirement && dep.installInstructions && (
                    <Flexbox gap={12}>
                      {dep.installInstructions.current && (
                        <Flexbox gap={4}>
                          <Text strong style={{ fontSize: 12 }}>
                            <Terminal size={12} style={{ marginRight: 4 }} />
                            {t('mcpInstall.installMethods.recommended')}
                          </Text>
                          <Snippet language={'bash'}>{dep.installInstructions.current}</Snippet>
                        </Flexbox>
                      )}

                      {dep.installInstructions.manual && (
                        <Flexbox gap={4}>
                          <Text strong style={{ fontSize: 12 }}>
                            <ExternalLink size={12} style={{ marginRight: 4 }} />
                            {t('mcpInstall.installMethods.manual')}
                          </Text>
                          <Markdown style={{ fontSize: 12 }}>
                            {dep.installInstructions.manual}
                          </Markdown>
                        </Flexbox>
                      )}
                    </Flexbox>
                  )}
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        </m.div>

        <m.div
          animate={{ opacity: 1, y: 0 }}
          {...stylex.props(styles.footer)}
          initial={{ opacity: 0, y: 4 }}
          transition={{ delay: 0.3, duration: 0.2 }}
        >
          <Flexbox horizontal justify={'space-between'}>
            <Button size="small" onClick={handleCancel}>
              {t('common:cancel')}
            </Button>
            <Flexbox horizontal align={'center'} gap={8}>
              <Button size="small" onClick={handleSkipCheck}>
                {t('mcpInstall.skipDependencies')}
              </Button>
              <Button size="small" type="primary" onClick={handleRetryCheck}>
                {t('mcpInstall.recheckDependencies')}
              </Button>
            </Flexbox>
          </Flexbox>
        </m.div>
      </m.div>
    );
  },
);

export default MCPDependenciesGuide;
