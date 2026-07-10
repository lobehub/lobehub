'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { Trans } from 'react-i18next';

import { type LobeLinkKind } from '@/features/Conversation/Markdown/plugins/Link/parse';
import LinkRender from '@/features/Conversation/Markdown/plugins/Link/Render';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bubble: css`
    align-self: flex-start;

    padding-block: 10px;
    padding-inline: 14px;
    border-radius: 12px;

    font-size: 14px;
    line-height: 1.8;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface SampleLinkProps {
  domain?: string;
  href: string;
  kind: LobeLinkKind;
  label: string;
}

// Reuse the real message link renderer so the preview reflects the live
// `enableMessageLinkIcon` setting exactly as chat messages do.
const SampleLink = memo<SampleLinkProps>(({ kind, href, label, domain }) => (
  <LinkRender
    id={`link-icon-preview-${kind}`}
    node={{ properties: { linkDomain: domain, linkHref: href, linkKind: kind, linkLabel: label } }}
    tagName="lobeLink"
    type="element"
  >
    {null}
  </LinkRender>
));

const LinkIconPreview = memo(() => (
  <div className={styles.bubble}>
    <Trans
      i18nKey="settingChatAppearance.linkIcon.previewMessage"
      ns="setting"
      components={{
        repo: (
          <SampleLink
            href="https://github.com/lobehub/lobehub"
            kind="github"
            label="lobehub/lobehub"
          />
        ),
        site: (
          <SampleLink
            domain="lobehub.com"
            href="https://lobehub.com"
            kind="generic"
            label="lobehub.com"
          />
        ),
      }}
    />
  </div>
));

LinkIconPreview.displayName = 'LinkIconPreview';

export default LinkIconPreview;
