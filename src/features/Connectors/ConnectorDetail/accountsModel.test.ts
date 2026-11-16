import { describe, expect, it } from 'vitest';

import type { ConnectorLinkSummary, ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { getAccountDetails, getAccountsSectionModel, getRowBusyAction } from './accountsModel';

const makeLink = (patch: Partial<ConnectorLinkSummary> & { id: string; name: string }) =>
  ({
    authorizedByAvatar: null,
    authorizedByName: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    profile: null,
    status: 'connected',
    ...patch,
  }) as ConnectorLinkSummary;

const work = makeLink({
  id: 'lnk_work',
  name: 'work@acme.com',
  profile: { email: 'work@acme.com' },
});
const personal = makeLink({
  id: 'lnk_personal',
  name: 'Personal',
  profile: { email: 'me@home.dev' },
});

const makeConnector = (links: ConnectorLinkSummary[], patch: Partial<ConnectorWithTools> = {}) =>
  ({
    authKind: 'oauth2',
    id: 'connector-1',
    links,
    mcpConnectionType: 'http',
    sourceType: 'custom',
    ...patch,
  }) as ConnectorWithTools;

const sectionFor = (
  links: ConnectorLinkSummary[],
  options: Partial<Parameters<typeof getAccountsSectionModel>[0]> = {},
) =>
  getAccountsSectionModel({
    canManage: true,
    connector: makeConnector(links),
    isDesktop: false,
    ...options,
  });

describe('getAccountsSectionModel', () => {
  it('makes connecting the first account the primary action', () => {
    expect(sectionFor([])).toEqual({
      add: { kind: 'connect', primary: true },
      empty: true,
      locked: false,
      showNamingHint: false,
      showSwitchHint: false,
    });
  });

  it('offers another account next to the switch-account hint once one is connected', () => {
    expect(sectionFor([work])).toEqual({
      add: { kind: 'connectAnother', primary: false },
      empty: false,
      locked: false,
      // A single account gets no link_id, so its name is not a choice yet.
      showNamingHint: false,
      showSwitchHint: true,
    });
  });

  it('asks for distinguishable names once the model chooses between accounts', () => {
    expect(sectionFor([work, personal]).showNamingHint).toBe(true);
  });

  it('drops the switch hint on desktop, whose window starts signed out', () => {
    expect(sectionFor([work], { isDesktop: true }).showSwitchHint).toBe(false);
  });

  it('has no add action on a connector that cannot hold several accounts', () => {
    const model = getAccountsSectionModel({
      canManage: true,
      connector: makeConnector([], { mcpConnectionType: 'stdio' }),
      isDesktop: false,
    });
    expect(model.add).toBeUndefined();
    expect(model.showSwitchHint).toBe(false);
  });

  it('locks the controls for a viewer who cannot manage, and while a flow runs', () => {
    expect(sectionFor([work], { canManage: false }).locked).toBe(true);
    expect(sectionFor([work], { busy: { kind: 'connect' } }).locked).toBe(true);
  });
});

describe('getRowBusyAction', () => {
  it('marks only the row the running action belongs to', () => {
    const busy = { kind: 'reauthorize', linkId: 'lnk_work' } as const;
    expect(getRowBusyAction(busy, 'lnk_work')).toBe('reauthorize');
    expect(getRowBusyAction(busy, 'lnk_personal')).toBeUndefined();
    expect(getRowBusyAction({ kind: 'connect' }, 'lnk_work')).toBeUndefined();
  });
});

describe('getAccountDetails', () => {
  const authorizer = (name: string) => `by ${name}`;

  it('skips an identity the name already shows', () => {
    expect(getAccountDetails(work)).toBe('');
    expect(getAccountDetails({ ...work, name: 'WORK@acme.com' })).toBe('');
  });

  it('shows the identity under a renamed account', () => {
    expect(getAccountDetails(personal)).toBe('me@home.dev');
    expect(
      getAccountDetails(makeLink({ id: 'l', name: 'Bot', profile: { username: 'octocat' } })),
    ).toBe('octocat');
  });

  it('adds nothing for an account without identity', () => {
    expect(getAccountDetails(makeLink({ id: 'l', name: 'Default' }), authorizer)).toBe('');
  });

  it('names the authorizer only when asked to (in a workspace)', () => {
    const shared = { ...personal, authorizedByName: 'Alex' };
    expect(getAccountDetails(shared)).toBe('me@home.dev');
    expect(getAccountDetails(shared, authorizer)).toBe('me@home.dev · by Alex');
  });
});
