'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { Trans } from 'react-i18next';

import { OFFICIAL_SITE } from '@/const/url';
import { EntityLinkRender, type LobeLinkKind } from '@/features/EntityLink';

const styles = stylex.create({
  bubble: {
    alignSelf: 'flex-start',
    paddingBlock: '10px',
    paddingInline: '14px',
    borderRadius: '12px',
    fontSize: '14px',
    lineHeight: 1.8,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface SampleLinkProps {
  domain?: string;
  href: string;
  kind: LobeLinkKind;
  label: string;
}

// Reuse the real message link renderer so the preview reflects the live
// `enableMessageLinkIcon` setting exactly as chat messages do.
const SampleLink = memo<SampleLinkProps>(({ kind, href, label, domain }) => (
  <EntityLinkRender
    id={`link-icon-preview-${kind}`}
    node={{ properties: { linkDomain: domain, linkHref: href, linkKind: kind, linkLabel: label } }}
    tagName="lobeLink"
    type="element"
  >
    {null}
  </EntityLinkRender>
));

const LinkIconPreview = memo(() => (
  <div {...stylex.props(styles.bubble)}>
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
            href={OFFICIAL_SITE}
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
