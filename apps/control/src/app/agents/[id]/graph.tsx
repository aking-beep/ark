import type { ReactNode } from 'react';
import type { AgentManifest } from '@ark/core';

/**
 * Infrastructure graph from the manifest only. Edges exist when the
 * corresponding inventory is present — nothing is invented.
 */
export function AgentGraph({ manifest }: { manifest: AgentManifest }) {
  const models = manifest.models;
  const tools = manifest.tools;
  const mcp = manifest.mcpServers;
  const integrations = manifest.integrations;
  const data = manifest.dataAccess;
  const hasData =
    data &&
    (data.containsPII ||
      data.containsFinancial ||
      data.containsHealth ||
      data.externalData ||
      (data.dataClasses ?? []).length > 0);

  const branches = [
    models.length > 0,
    mcp.length > 0,
    tools.length > 0,
    integrations.length > 0,
    Boolean(hasData),
  ].filter(Boolean).length;

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[40rem] flex-col items-center gap-3 py-2">
        <Node label={manifest.name} kind="agent" sub={manifest.id} />
        {branches > 0 && <span className="h-6 w-px bg-ink-600" />}
        <div className="flex flex-wrap items-start justify-center gap-6">
          {models.length > 0 && (
            <Column title="Models">
              {models.map((m) => (
                <Node key={`${m.provider}:${m.modelId}`} label={m.modelId} kind="model" sub={m.provider} />
              ))}
            </Column>
          )}
          {mcp.length > 0 && (
            <Column title="MCP servers">
              {mcp.map((s) => (
                <Node key={s.name} label={s.name} kind="mcp" sub={s.transport} />
              ))}
            </Column>
          )}
          {tools.length > 0 && (
            <Column title="Tools">
              {tools.map((t) => (
                <Node key={t.name} label={t.name} kind="tool" sub={t.type} />
              ))}
            </Column>
          )}
          {integrations.length > 0 && (
            <Column title="Integrations">
              {integrations.map((i) => (
                <Node key={i.name} label={i.name} kind="integration" sub={i.type} />
              ))}
            </Column>
          )}
          {hasData && data && (
            <Column title="Data">
              <Node
                label={(data.dataClasses ?? []).join(', ') || 'data access'}
                kind="data"
                sub={[
                  data.containsPII ? 'PII' : null,
                  data.containsFinancial ? 'financial' : null,
                  data.containsHealth ? 'health' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined}
              />
            </Column>
          )}
        </div>
        {branches === 0 && (
          <p className="text-xs text-ink-500">No inventory on this manifest yet — no edges to draw.</p>
        )}
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[9rem] flex-col items-center gap-2">
      <span className="h-6 w-px bg-ink-600" />
      <p className="text-2xs uppercase tracking-wide text-ink-500">{title}</p>
      <div className="flex flex-col items-stretch gap-2">{children}</div>
    </div>
  );
}

function Node({
  label,
  sub,
  kind,
}: {
  label: string;
  sub?: string;
  kind: 'agent' | 'model' | 'mcp' | 'tool' | 'integration' | 'data';
}) {
  const ring =
    kind === 'agent'
      ? 'border-signal text-ink-100'
      : kind === 'data'
        ? 'border-warn/60 text-ink-200'
        : 'border-ink-600 text-ink-200';
  return (
    <div className={`min-w-[8rem] rounded-md border bg-ink-900 px-3 py-2 text-center ${ring}`}>
      <p className="truncate font-mono text-xs">{label}</p>
      {sub && <p className="mt-0.5 truncate text-2xs text-ink-500">{sub}</p>}
    </div>
  );
}
