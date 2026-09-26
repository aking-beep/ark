import Link from 'next/link';
import { Panel, Callout } from '@ark/ui';
import { requireOrg } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function Start() {
  await requireOrg();
  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="font-mono text-2xs uppercase tracking-widest text-signal">Connect</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-100">Get a trace on screen in five minutes</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">
          ARK Control observes. It does not sit in the request path and it does not store prompts.
          Wrap the client you already have, run one unit of work, and the Spend page will have something
          to say. Control is its own product. The map of the three products — AI Fit, AI Fit Teams, and
          Control — is <code className="font-mono text-ink-200">docs/08-how-ark-works.md</code>.
        </p>
      </header>

      <Step n="1" title="Wrap the SDK you already have">
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <p>
            <code className="font-mono text-signal">run()</code> is one unit of business work.{' '}
            <code className="font-mono text-signal">instrumentFetch</code> records each OpenAI{' '}
            <code className="font-mono">/chat/completions</code> or Anthropic{' '}
            <code className="font-mono">/v1/messages</code> call as a turn on that unit. The prompt never
            leaves the process. This is Control&apos;s path. It does not open AI Fit or AI Fit Teams.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-ink-900 p-4 font-mono text-2xs leading-relaxed text-ink-200">{SDK_SNIPPET}</pre>
        </div>
      </Step>

      <div className="grid gap-4 lg:grid-cols-2">
        <Step n="2" title="Or send one sample from AI Fit Teams">
          <p>
            A report on port 3001 can <code className="font-mono text-signal">POST /api/measure</code> — one
            synthetic Runtime call, never the workload description. Point that app at this Control with{' '}
            <code className="font-mono text-signal">ARK_CONTROL_URL</code> and{' '}
            <code className="font-mono text-signal">ARK_CONTROL_TOKEN</code>. Until a pattern clears 30 traces,
            cost figures stay <span className="font-mono text-warn">heuristic</span>. That is correct.
          </p>
        </Step>
        <Step n="3" title="Protocol evidence on the same trace">
          <p>
            An MCP tool call, an A2A delegate, an AG-UI approval, an A2UI surface, a UCP checkout or an AP2
            mandate is one observation, correlated by the handle <code className="font-mono text-signal">run()</code>{' '}
            already opened. No payload is stored.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-ink-900 p-4 font-mono text-2xs leading-relaxed text-ink-200">{EVIDENCE_SNIPPET}</pre>
        </Step>
      </div>

      <Callout tone="info" title="The token stays in the environment">
        Snippets name <code className="font-mono">ARK_CONTROL_URL</code> and{' '}
        <code className="font-mono">ARK_CONTROL_TOKEN</code>. They never interpolate a bearer. Set the token
        in the environment of the process that makes the model calls; it does not belong in this page, in
        git, or in a screenshot.
      </Callout>

      <Panel
        title="What you should see next"
        subtitle="Spend is cost per outcome. Protocols is what the agent did. Workloads is the drift against the estimate."
      >
        <ul className="space-y-2 text-sm text-ink-300">
          <li>
            <Link href="/dashboard" className="text-signal underline underline-offset-2">Spend</Link>
            {' '}— cost per successful outcome, not per call.
          </li>
          <li>
            <Link href="/protocols" className="text-signal underline underline-offset-2">Protocols</Link>
            {' '}— MCP, A2A, AG-UI, A2UI, UCP, AP2 as one grain.
          </li>
          <li>
            <Link href="/workloads" className="text-signal underline underline-offset-2">Workloads</Link>
            {' '}— what AI Fit Teams predicted versus what ran.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-850 p-5 shadow-panel">
      <p className="font-mono text-2xs uppercase tracking-widest text-ink-500">Step {n}</p>
      <h2 className="mt-1 text-sm font-semibold text-ink-100">{title}</h2>
      <div className="mt-3 space-y-2 text-xs leading-relaxed text-ink-400">{children}</div>
    </section>
  );
}

const SDK_SNIPPET = `import OpenAI from 'openai';
import { ArkIngest } from '@ark/sdk';

const ark = new ArkIngest({
  baseUrl: process.env.ARK_CONTROL_URL!,
  token: process.env.ARK_CONTROL_TOKEN,
});
const openai = new OpenAI({ fetch: ark.instrumentFetch() });

await ark.run('wl_support_triage', async () => {
  await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'summarise this ticket' }],
  });
});`;

const EVIDENCE_SNIPPET = `import { mcpEvidence } from '@ark/protocols';

await ark.run('wl_support_triage', async (trace) => {
  const result = await openai.chat.completions.create({ /* ... */ });
  trace.evidence(mcpEvidence({
    method: 'tools/call', name: 'search_customer',
    client: 'support-agent', server: 'crm-mcp', latencyMs: 84,
  }));
  return result;
});`;
