/**
 * @vitest-environment happy-dom
 */
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Render from './index';

const mockConst = vi.hoisted(() => ({
  isDesktop: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return mockConst.isDesktop;
  },
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ActionIcon: ({ icon: _icon, onClick, title, ...rest }: any) => (
    <button {...rest} aria-label={title} type="button" onClick={onClick} />
  ),
}));

// `enableMessageLinkIcon` is read via useUserStore(selector). We drive the
// selector's return value through this module-level flag so each case can flip
// the "Link Icon" setting on/off without a real store.
let mockShowIcon = true;
const mockOpenInBrowserTab = vi.fn();
const mockNavigate = vi.fn();
const mockOpenAcceptance = vi.fn();
const mockOpenAgentDetail = vi.fn();
const mockOpenDocument = vi.fn();
const mockOpenTaskDetail = vi.fn();
const mockOpenVerifyReport = vi.fn();

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => [{ id: 'ws-1', slug: 'lobe-team' }],
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mockNavigate,
}));

// What the shared preview/title read answers for this case (null = unresolved).
let mockEntityPreview: { title?: string } | null = null;

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown) => {
    if (Array.isArray(key) && key[0] === 'internal-entity-preview')
      return { data: mockEntityPreview, mutate: vi.fn() };
    return {
      data: [{ documentId: 'docs_doc1', id: 'agent-document-1' }],
      mutate: vi.fn(),
    };
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { listDocuments: vi.fn() },
  agentDocumentSWRKeys: { documentsList: (agentId: string) => ['agent-documents', agentId] },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({ activeAgentId: 'agt_1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      openAcceptance: mockOpenAcceptance,
      openAgentDetail: mockOpenAgentDetail,
      openDocument: mockOpenDocument,
      openTaskDetail: mockOpenTaskDetail,
      openVerifyReport: mockOpenVerifyReport,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector(undefined),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    enableMessageLinkIcon: () => mockShowIcon,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) =>
    selector({ openInBrowserTab: mockOpenInBrowserTab }),
}));

const renderLink = (properties: Record<string, unknown>) =>
  render(
    <Render id="msg-1" node={{ properties }} tagName="lobeLink" type="element">
      {null}
    </Render>,
  );

afterEach(() => {
  mockShowIcon = true;
  mockConst.isDesktop = false;
  mockEntityPreview = null;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Link Render — message link icon toggle', () => {
  describe('when enableMessageLinkIcon is ON (default)', () => {
    it('renders a generic link with a leading favicon icon', () => {
      mockShowIcon = true;
      const { container } = renderLink({
        linkDomain: 'thecoffee.club',
        linkHref: 'https://thecoffee.club',
        linkKind: 'generic',
        linkLabel: 'https://thecoffee.club',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor).toBeTruthy();
      expect(anchor.getAttribute('href')).toBe('https://thecoffee.club');
      // icon span + favicon <img> present before the label
      expect(anchor.querySelector('span')).toBeTruthy();
      expect(anchor.querySelector('img')).toBeTruthy();
      expect(anchor.textContent).toContain('https://thecoffee.club');
    });

    it('renders a github link with an icon (svg)', () => {
      mockShowIcon = true;
      const { container } = renderLink({
        linkHref: 'https://github.com/lobehub/lobehub',
        linkKind: 'github',
        linkLabel: 'lobehub/lobehub',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor.querySelector('span')).toBeTruthy();
      expect(anchor.querySelector('svg')).toBeTruthy();
    });
  });

  describe('when enableMessageLinkIcon is OFF', () => {
    it('renders a generic link as a plain anchor with NO icon', () => {
      mockShowIcon = false;
      const { container } = renderLink({
        linkDomain: 'thecoffee.club',
        linkHref: 'https://thecoffee.club',
        linkKind: 'generic',
        linkLabel: 'https://thecoffee.club',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor).toBeTruthy();
      expect(anchor.getAttribute('href')).toBe('https://thecoffee.club');
      // no icon span, no favicon img — copies cleanly into email/other apps
      expect(anchor.querySelector('span')).toBeNull();
      expect(anchor.querySelector('img')).toBeNull();
      expect(anchor.textContent).toBe('https://thecoffee.club');
    });

    it('drops the icon for every link kind (github / linear / email)', () => {
      mockShowIcon = false;
      for (const properties of [
        {
          linkHref: 'https://github.com/lobehub/lobehub',
          linkKind: 'github',
          linkLabel: 'lobehub/lobehub',
        },
        { linkHref: 'https://linear.app/x/issue/ABC-1', linkKind: 'linear', linkLabel: 'ABC-1' },
        { linkHref: 'mailto:a@b.com', linkKind: 'email', linkLabel: 'a@b.com' },
      ]) {
        const { container } = renderLink(properties);
        const anchor = container.querySelector('a')!;
        expect(anchor.querySelector('span')).toBeNull();
        expect(anchor.querySelector('svg')).toBeNull();
        expect(anchor.querySelector('img')).toBeNull();
      }
    });
  });
});

describe('Link Render — internal entities', () => {
  it('replaces a pasted URL label with the resolved entity title', () => {
    // A raw acceptance URL says nothing about what it points to; once the
    // entity resolves, the link reads as its title.
    mockEntityPreview = { title: 'Gateway 消息队列重建' };

    const { container } = renderLink({
      linkHref: '/acceptance/acceptance-1',
      linkKind: 'generic',
      linkLabel: '/acceptance/acceptance-1',
    });

    const anchor = container.querySelector('a')!;
    expect(anchor.textContent).toBe('Gateway 消息队列重建');
    expect(anchor.getAttribute('href')).toBe('/acceptance/acceptance-1');
  });

  it('keeps the pasted URL while the title has not resolved', () => {
    mockEntityPreview = null;

    const { container } = renderLink({
      linkHref: '/acceptance/acceptance-1',
      linkKind: 'generic',
      linkLabel: '/acceptance/acceptance-1',
    });

    expect(container.querySelector('a')!.textContent).toBe('/acceptance/acceptance-1');
  });

  it('never replaces authored link text with the entity title', () => {
    mockEntityPreview = { title: 'Resolved title' };

    const { container } = renderLink({
      linkHref: '/acceptance/acceptance-1',
      linkKind: 'generic',
      linkLabel: 'Acceptance',
    });

    expect(container.querySelector('a')!.textContent).toBe('Acceptance');
  });

  it('keeps a URL-shaped authored label — bare means label === href, not "looks like a URL"', () => {
    mockEntityPreview = { title: 'Resolved title' };

    const { container } = renderLink({
      linkHref: '/task/T-198',
      linkKind: 'generic',
      linkLabel: 'https://docs.example',
    });

    expect(container.querySelector('a')!.textContent).toBe('https://docs.example');
  });

  it('does not resolve titles for workspace-qualified links', () => {
    // The ambient client reads the ACTIVE scope; /lobe-team/task/T-198 may
    // name a different entity there, so the URL stays.
    mockEntityPreview = { title: 'Wrong-scope title' };

    const { container } = renderLink({
      linkHref: '/lobe-team/task/T-198',
      linkKind: 'generic',
      linkLabel: '/lobe-team/task/T-198',
    });

    expect(container.querySelector('a')!.textContent).toBe('/lobe-team/task/T-198');
  });

  it('opens acceptance links in the conversation portal', () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    const { getByRole } = renderLink({
      linkHref: '/acceptance/acceptance-1',
      linkKind: 'generic',
      linkLabel: 'Acceptance',
    });

    fireEvent.click(getByRole('link', { name: 'Acceptance' }));

    expect(mockOpenAcceptance).toHaveBeenCalledWith('acceptance-1');
    expect(assign).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens official document links in the conversation portal', () => {
    const { getByRole } = renderLink({
      linkHref: '/agent/agt_1/docs/doc1',
      linkKind: 'generic',
      linkLabel: 'Research notes',
    });

    fireEvent.click(getByRole('link', { name: 'Research notes' }));

    expect(mockOpenDocument).toHaveBeenCalledWith('docs_doc1', 'agent-document-1');
    expect(getByRole('link', { name: 'Research notes' })).toHaveAttribute(
      'href',
      '/agent/agt_1/docs/doc1',
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens tasks and agents in their portal views', () => {
    const task = renderLink({
      linkHref: '/task/T-198',
      linkKind: 'generic',
      linkLabel: 'T-198',
    });
    fireEvent.click(task.getByRole('link', { name: 'T-198' }));
    expect(mockOpenTaskDetail).toHaveBeenCalledWith('T-198');
    task.unmount();

    const agent = renderLink({
      linkHref: '/agent/agt_1',
      linkKind: 'generic',
      linkLabel: 'Research agent',
    });
    fireEvent.click(agent.getByRole('link', { name: 'Research agent' }));
    expect(mockOpenAgentDetail).toHaveBeenCalledWith('agt_1');
  });

  it('hard-navigates personal verify pages into the Workbench runtime', () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    const { getByRole } = renderLink({
      linkHref: '/verify/run-1',
      linkKind: 'generic',
      linkLabel: 'Verify report',
    });

    fireEvent.click(getByRole('link', { name: 'Verify report' }));

    expect(assign).toHaveBeenCalledWith('/verify/run-1');
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockOpenVerifyReport).not.toHaveBeenCalled();
  });

  it('opens a verify link for the active workspace in the report portal', () => {
    const { getByRole } = renderLink({
      linkHref: '/lobe-team/verify/run-1',
      linkKind: 'generic',
      linkLabel: 'LobeHub Verify',
    });

    fireEvent.click(getByRole('link', { name: 'LobeHub Verify' }));

    expect(mockOpenVerifyReport).toHaveBeenCalledWith('run-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('preserves modifier-click browser behavior on web', () => {
    const { getByRole } = renderLink({
      linkHref: '/task/T-198',
      linkKind: 'generic',
      linkLabel: 'T-198',
    });

    fireEvent.click(getByRole('link', { name: 'T-198' }), { metaKey: true });

    expect(mockOpenTaskDetail).not.toHaveBeenCalled();
  });

  it('takes over modifier-clicks on desktop, which has no new tab to open', () => {
    mockConst.isDesktop = true;

    const { getByRole } = renderLink({
      linkHref: '/task/T-198',
      linkKind: 'generic',
      linkLabel: 'T-198',
    });

    fireEvent.click(getByRole('link', { name: 'T-198' }), { metaKey: true });

    expect(mockOpenTaskDetail).toHaveBeenCalledWith('T-198');
  });
});

// The desktop preload intercepts every anchor click in the capture phase and, unless
// the renderer has claimed the link, stops propagation before React's onClick runs.
// Dropping this attribute would silently send internal links to the system browser.
describe('Link Render — desktop preload contract', () => {
  it('marks internal entity links as renderer-handled', () => {
    const { getByRole } = renderLink({
      linkHref: '/verify/run-1',
      linkKind: 'generic',
      linkLabel: 'Verify report',
    });

    expect(getByRole('link', { name: 'Verify report' })).toHaveAttribute(
      RENDERER_HANDLED_LINK_ATTR,
      'true',
    );
  });

  it('leaves external links unclaimed so the preload opens them in the system browser', () => {
    const { container } = renderLink({
      linkDomain: 'github.com',
      linkHref: 'https://github.com/lobehub/lobehub',
      linkKind: 'github',
      linkLabel: 'lobehub/lobehub',
    });

    expect(container.querySelector('a')).not.toHaveAttribute(RENDERER_HANDLED_LINK_ATTR);
  });
});

describe('Link Render — open an external link in the side browser', () => {
  const renderExternal = () =>
    renderLink({
      linkDomain: 'localhost',
      linkHref: 'http://localhost:3022/observability/context',
      linkKind: 'generic',
      linkLabel: 'http://localhost:3022/observability/context',
    });

  it('offers the side-browser action on desktop', () => {
    mockConst.isDesktop = true;

    const { container } = renderExternal();
    const action = container.querySelector('[data-side-browser]')!;
    expect(action).toBeTruthy();

    fireEvent.click(action);

    expect(mockOpenInBrowserTab).toHaveBeenCalledWith(
      'http://localhost:3022/observability/context',
    );
  });

  it('keeps the action OUTSIDE the anchor, or the preload would swallow its click', () => {
    mockConst.isDesktop = true;

    const { container } = renderExternal();

    // The preload intercepts clicks via closest('a') in the capture phase, so an
    // action nested inside the link would never reach React.
    expect(container.querySelector('a [data-side-browser]')).toBeNull();
    expect(container.querySelector('[data-side-browser]')!.closest('a')).toBeNull();
  });

  it('leaves the anchor itself untouched, so a plain click still opens the system browser', () => {
    mockConst.isDesktop = true;

    const { container } = renderExternal();
    const anchor = container.querySelector('a')!;

    expect(anchor).not.toHaveAttribute(RENDERER_HANDLED_LINK_ATTR);
    expect(anchor).toHaveAttribute('target', '_blank');

    fireEvent.click(anchor);
    expect(mockOpenInBrowserTab).not.toHaveBeenCalled();
  });

  it('hides the action on web', () => {
    mockConst.isDesktop = false;
    const web = renderExternal();
    expect(web.container.querySelector('[data-side-browser]')).toBeNull();
  });

  it('hides the action for non-web links (mailto) and for portal-bound internal links', () => {
    mockConst.isDesktop = true;

    const email = renderLink({
      linkHref: 'mailto:a@b.com',
      linkKind: 'email',
      linkLabel: 'a@b.com',
    });
    expect(email.container.querySelector('[data-side-browser]')).toBeNull();
    email.unmount();

    const internal = renderLink({
      linkHref: '/verify/run-1',
      linkKind: 'generic',
      linkLabel: 'Verify report',
    });
    expect(internal.container.querySelector('[data-side-browser]')).toBeNull();
  });

  it('navigates non-entity app routes without leaving the SPA', () => {
    const { getByRole } = renderLink({
      linkHref: '/settings/profile',
      linkKind: 'generic',
      linkLabel: 'Profile settings',
    });

    fireEvent.click(getByRole('link', { name: 'Profile settings' }));

    expect(mockNavigate).toHaveBeenCalledWith('/settings/profile');
  });

  it('preserves workspace prefixes for workspace-qualified SPA routes', () => {
    const { getByRole } = renderLink({
      linkHref: '/lobe-team/tasks',
      linkKind: 'generic',
      linkLabel: 'Workspace tasks',
    });

    fireEvent.click(getByRole('link', { name: 'Workspace tasks' }));

    expect(mockNavigate).toHaveBeenCalledWith('/lobe-team/tasks', { escape: true });
  });

  it('navigates workspace-qualified entities before opening a scoped portal', () => {
    const { getByRole, queryByRole } = renderLink({
      linkHref: '/lobe-team/task/T-198',
      linkKind: 'generic',
      linkLabel: 'Workspace task',
    });

    fireEvent.click(getByRole('link', { name: 'Workspace task' }));

    expect(mockNavigate).toHaveBeenCalledWith('/lobe-team/task/T-198', { escape: true });
    expect(mockOpenTaskDetail).not.toHaveBeenCalled();
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves a different agent context for agent-scoped document links', () => {
    const { getByRole } = renderLink({
      linkHref: '/agent/agt_other/docs/docs_1',
      linkKind: 'generic',
      linkLabel: 'Another agent document',
    });

    fireEvent.click(getByRole('link', { name: 'Another agent document' }));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/agt_other/docs/docs_1', { escape: true });
    expect(mockOpenDocument).not.toHaveBeenCalled();
  });
});
