import { Flexbox, Highlighter, Snippet, Steps, Tabs } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ProviderCombine } from '@/components/LobeIcons';

const stepsStyles = {
  description: { marginBlockEnd: 24 },
  title: { fontSize: 16, fontWeight: 'bold', marginBlockEnd: 16 },
} as const;

const SetupGuide = memo(() => {
  const { t } = useTranslation('components');
  return (
    <>
      <ProviderCombine provider={'ollama'} size={30} style={{ marginBottom: -8, marginLeft: 4 }} />
      <Tabs
        items={[
          {
            children: (
              <Steps
                orientation={'vertical'}
                style={{ marginBlockStart: 32 }}
                styles={stepsStyles}
                items={[
                  {
                    description: (
                      <Trans
                        i18nKey={'OllamaSetupGuide.install.description'}
                        ns={'components'}
                        components={[
                          <span key="0" />,
                          <a
                            href={'https://ollama.com/download'}
                            key="1"
                            rel="noreferrer"
                            target="_blank"
                          />,
                        ]}
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
                            {}
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
              />
            ),
            key: 'macos',
            label: 'macOS',
          },
          {
            children: (
              <Steps
                orientation={'vertical'}
                style={{ marginBlockStart: 32 }}
                styles={stepsStyles}
                items={[
                  {
                    description: (
                      <Trans
                        i18nKey={'OllamaSetupGuide.install.description'}
                        ns={'components'}
                        components={[
                          <span key="0" />,
                          <a
                            href={'https://ollama.com/download'}
                            key="1"
                            rel="noreferrer"
                            target="_blank"
                          />,
                        ]}
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
              />
            ),
            key: 'windows',
            label: t('OllamaSetupGuide.install.windowsTab'),
          },
          {
            children: (
              <Steps
                orientation={'vertical'}
                style={{ marginBlockStart: 32 }}
                styles={stepsStyles}
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
                            i18nKey={'OllamaSetupGuide.install.linux.manual'}
                            ns={'components'}
                            components={[
                              <span key="0" />,
                              <a
                                href={'https://github.com/ollama/ollama/blob/main/docs/linux.md'}
                                key="1"
                                rel="noreferrer"
                                target="_blank"
                              />,
                            ]}
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
                        {}
                        <Snippet language={'bash'}> sudo systemctl edit ollama.service</Snippet>
                        {t('OllamaSetupGuide.cors.linux.env')}
                        <Highlighter
                          fullFeatured
                          showLanguage
                          fileName={'ollama.service'}
                          language={'bash'}
                          children={`[Service]

Environment="OLLAMA_ORIGINS=*"`}
                        />
                        {t('OllamaSetupGuide.cors.linux.reboot')}
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
              />
            ),
            key: 'linux',
            label: 'Linux',
          },
          {
            children: (
              <Steps
                orientation={'vertical'}
                style={{ marginBlockStart: 32 }}
                styles={stepsStyles}
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
                          fullFeatured
                          showLanguage
                          fileName={'ollama.service'}
                          language={'bash'}
                        >
                          {}
                          docker run -d --gpus=all -v ollama:/root/.ollama -e OLLAMA_ORIGINS="*" -p
                          11434:11434 --name ollama ollama/ollama
                        </Highlighter>
                      </Flexbox>
                    ),
                    status: 'process',
                    title: t('OllamaSetupGuide.cors.title'),
                  },
                ]}
              />
            ),
            key: 'docker',
            label: 'Docker',
          },
        ]}
        style={{
          width: '500px',
        }}
      />
    </>
  );
});

export default SetupGuide;
