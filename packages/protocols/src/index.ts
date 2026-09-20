/**
 * @ark/protocols — protocol adapters, not protocol implementations.
 *
 * Six agent protocols in, one canonical `EvidenceObservation` out:
 *
 *   protocol-native event → validation → redaction → normalisation → ARK
 *
 * This package executes nothing. It calls no MCP tool, submits no A2A task,
 * renders no UI, completes no checkout and moves no money. It has no I/O, no
 * network access and no dependency other than `@ark/core`, whose evidence
 * schema it targets. The dependency points one way and always will: adding
 * `@ark/protocols` to `@ark/core` would make the canonical schema a function
 * of six external release cycles, which is the thing the adapter layer exists
 * to prevent.
 *
 * Each adapter records, in its own file, the exact specification revision it
 * was built against, and exports that protocol's official vocabulary verbatim
 * so a reader can check it against the spec without reading the code.
 *
 * See docs/07-protocol-evidence.md and docs/adr/0007.
 */

export type { NormalisedEvidence, ObservationBase } from './types.js';
export { money, vocabulary } from './types.js';

export * from './mcp.js';
export * from './a2a.js';
export * from './ag-ui.js';
export * from './a2ui.js';
export * from './ucp.js';
export * from './ap2.js';

import { MCP_SPEC_VERSION } from './mcp.js';
import { A2A_SPEC_VERSION } from './a2a.js';
import { AGUI_SPEC_VERSION } from './ag-ui.js';
import { A2UI_SPEC_VERSION } from './a2ui.js';
import { UCP_SPEC_VERSION } from './ucp.js';
import { AP2_SPEC_VERSION } from './ap2.js';
import type { Protocol } from '@ark/core';

/**
 * What each adapter was built against. Rendered on the Protocols page, so an
 * operator looking at a count can see which revision produced it rather than
 * having to trust that it is current.
 */
export const PROTOCOL_SPEC_VERSIONS: Record<Protocol, string> = {
  mcp: MCP_SPEC_VERSION,
  a2a: A2A_SPEC_VERSION,
  'ag-ui': AGUI_SPEC_VERSION,
  a2ui: A2UI_SPEC_VERSION,
  ucp: UCP_SPEC_VERSION,
  ap2: AP2_SPEC_VERSION,
};

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  mcp: 'MCP',
  a2a: 'A2A',
  'ag-ui': 'AG-UI',
  a2ui: 'A2UI',
  ucp: 'UCP',
  ap2: 'AP2',
};

export const PROTOCOL_DESCRIPTIONS: Record<Protocol, string> = {
  mcp: 'Model Context Protocol — tools, resources and prompts an agent reached for.',
  a2a: 'Agent2Agent — which agent delegated what to which peer.',
  'ag-ui': 'Agent User Interaction — where a human intervened, approved or refused.',
  a2ui: 'Agent-to-User Interface — UI an agent asked a trusted frontend to render.',
  ucp: 'Universal Commerce Protocol — carts, checkouts and orders acted on.',
  ap2: 'Agent Payments Protocol — mandates and receipts authorising money.',
};
