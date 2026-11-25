/**
 * Whether the desktop execution-environment picker offers "Local Sandbox".
 *
 * Off for now: the row, its Set up button and its network switch are hidden,
 * and the picker no longer probes the host's sandbox capability. Only the
 * entry is hidden — an agent or topic already set to the fenced local run
 * keeps running fenced, and the chip still says so. Flip this to bring the row
 * back unchanged.
 */
export const LOCAL_SANDBOX_ENTRY_ENABLED = false;
