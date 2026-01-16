import { ProviderCombine } from '@lobehub/icons';
import { Flexbox, Highlighter, Snippet, Tabs } from '@lobehub/ui';
import { Steps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { readableColor } from 'polished';
import React, { memo, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  steps: css`
    margin-block-start: 32px;
    &.${prefixCls}-steps-small .${prefixCls}-steps-item-title {
      margin-block-end: 16px;
      font-size: 16px;
      font-weight: bold;
    }

    .${prefixCls}-steps-item-description {
      margin-block-end: 24px;
    }

    .${prefixCls}-steps-icon {
      color: var(--steps-icon-color, ${cssVar.colorText}) !important;
    }
  `,
}));

const SetupGuide = memo(() => {
  const iconColor = useMemo(() => readableColor(cssVar.colorPrimary), []);
  const { t } = useTranslation('components');
  return (
    <>
      <ProviderCombine provider={'ollama'} size={30} style={{ marginBottom: -8, marginLeft: 4 }} />
      <Tabs
        compact
        items={[
          {
            children: (
              <Steps
                className={styles.steps}
                direction={'vertical'}
                items={[
                  {
                    description: (
                      <Trans
                        components={[
                          <span key="0" />,
                          <a href={'https://ollama.com/download'} key="1" rel="noreferrer" target="_blank" />,
                        ]}
                        i18nKey={'OllamaSetupGuide.install.description'}
                        ns={'components'}
                      />
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.install.title'),
                  },
                  {
                    description: (
                      <Flexbox gap={8}>
                        {t('OllamaSetupGuide.cors.description')}

                        <Flexbox gap={8}>
                          {t('OllamaSetupGuide.cors.macos')}
                          <Snippet language={'bash'}>
                            {/* eslint-disable-next-line react/no-unescaped-entities */}
                            launchctl setenv OLLAMA_ORIGINS "*"
                          </Snippet>
                          {t('OllamaSetupGuide.cors.reboot')}
                        </Flexbox>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
                size={'small'}
                style={{ '--steps-icon-color': iconColor } as React.CSSProperties}
              />
            ),
            key: 'macos',
            label: 'macOS',
          },
          {
            children: (
              <Steps
                className={styles.steps}
                direction={'vertical'}
                items={[
                  {
                    description: (
                      <Trans
                        components={[
                          <span key="0" />,
                          <a href={'https://ollama.com/download'} key="1" rel="noreferrer" target="_blank" />,
                        ]}
                        i18nKey={'OllamaSetupGuide.install.description'}
                        ns={'components'}
                      />
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.install.title'),
                  },
                  {
                    description: (
                      <Flexbox gap={8}>
                        {t('OllamaSetupGuide.cors.description')}
                        <div>{t('OllamaSetupGuide.cors.windows')}</div>
                        <div>{t('OllamaSetupGuide.cors.reboot')}</div>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
                size={'small'}
                style={{ '--steps-icon-color': iconColor } as React.CSSProperties}
              />
            ),
            key: 'windows',
            label: t('OllamaSetupGuide.install.windowsTab'),
          },
          {
            children: (
              <Steps
                className={styles.steps}
                direction={'vertical'}
                items={[
                  {
                    description: (
                      <Flexbox gap={8}>
                        {t('OllamaSetupGuide.install.linux.command')}
                        <Snippet language={'bash'}>
                          curl -fsSL https://ollama.com/install.sh | sh
                        </Snippet>
                        <div>
                          <Trans
                            components={[
                              <span key="0" />,
                              <a
                                href={'https://github.com/ollama/ollama/blob/main/docs/linux.md'}
                                key="1"
                                rel="noreferrer"
                                target="_blank"
                              />,
                            ]}
                            i18nKey={'OllamaSetupGuide.install.linux.manual'}
                            ns={'components'}
                          />
                        </div>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.install.title'),
                  },
                  {
                    description: (
                      <Flexbox gap={8}>
                        <div>{t('OllamaSetupGuide.cors.description')}</div>

                        <div>{t('OllamaSetupGuide.cors.linux.systemd')}</div>
                        {/* eslint-disable-next-line react/no-unescaped-entities */}
                        <Snippet language={'bash'}> sudo systemctl edit ollama.service</Snippet>
                        {t('OllamaSetupGuide.cors.linux.env')}
                        <Highlighter
                          // eslint-disable-next-line react/no-children-prop
                          children={`[Service]

Environment="OLLAMA_ORIGINS=*"`}
                          fileName={'ollama.service'}
                          fullFeatured
                          language={'bash'}
                          showLanguage
                        />
                        {t('OllamaSetupGuide.cors.linux.reboot')}
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
                size={'small'}
                style={{ '--steps-icon-color': iconColor } as React.CSSProperties}
              />
            ),
            key: 'linux',
            label: 'Linux',
          },
          {
            children: (
              <Steps
                className={styles.steps}
                direction={'vertical'}
                items={[
                  {
                    description: (
                      <Flexbox gap={8}>
                        {t('OllamaSetupGuide.install.description')}
                        <div>{t('OllamaSetupGuide.install.docker')}</div>
                        <Snippet language={'bash'}>docker pull ollama/ollama</Snippet>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.install.title'),
                  },
                  {
                    description: (
                      <Flexbox gap={8}>
                        {t('OllamaSetupGuide.cors.description')}
                        <Highlighter
                          fileName={'ollama.service'}
                          fullFeatured
                          language={'bash'}
                          showLanguage
                        >
                          {/* eslint-disable-next-line react/no-unescaped-entities */}
                          docker run -d --gpus=all -v ollama:/root/.ollama -e OLLAMA_ORIGINS="*" -p
                          11434:11434 --name ollama ollama/ollama
                        </Highlighter>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
                size={'small'}
                style={{ '--steps-icon-color': iconColor } as React.CSSProperties}
              />
            ),
            key: 'docker',
            label: 'Docker',
          },
        ]}
      />
    </>
  );
});

export default SetupGuide;
