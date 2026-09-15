"use client";

import type { ScoreResult } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function WorkstyleCard({
  result,
  onCopy,
  copied,
}: {
  result: ScoreResult;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const workstyle = result.workstyle;
  const stack = (result.operating_stack ?? [])
    .map((slot) => slot.product?.name)
    .filter(Boolean)
    .slice(0, 5)
    .join(" · ");

  return (
    <div className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-6 shadow-sm">
      <p className="text-xs uppercase tracking-[0.25em] text-primary">Fit</p>
      <h3 className="mt-2 text-2xl font-semibold tracking-tight">{workstyle?.label ?? result.persona.label}</h3>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">{workstyle?.narrative ?? workstyle?.summary}</p>
      {workstyle?.dimensions?.length ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {workstyle.dimensions.map((dimension) => (
            <span key={dimension.id}>
              <span className="text-muted-foreground">{dimension.label}</span>{" "}
              <span className="font-medium">{dimension.display ?? Math.round(dimension.score * 100)}</span>
            </span>
          ))}
        </div>
      ) : null}
      {stack ? <p className="mt-4 text-sm text-muted-foreground">Tools: {stack}</p> : null}
      {onCopy ? (
        <Button className="mt-4" size="sm" variant="outline" onClick={onCopy}>
          {copied ? "Copied card" : "Copy this card"}
        </Button>
      ) : null}
    </div>
  );
}
