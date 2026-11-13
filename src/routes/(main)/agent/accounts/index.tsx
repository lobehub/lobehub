'use client';

import { AgentProfileView } from '../profile';

/** `/agent/:aid/accounts` — the subscription accounts a Claude Code agent runs on, and their balancing. */
const AgentAccountsPage = () => <AgentProfileView view="accounts" />;

export default AgentAccountsPage;
