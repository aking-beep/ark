"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { ScoreResult } from "@/lib/types";
import { clearSession, encodeSharePayload, loadSession, saveResult } from "@/lib/session-store";
import { copyText, isAppleTouch, shareOrCopy } from "@/lib/copy-text";
import { useReadingLevel } from "@/components/reading-level";
import { cleanModelName, friendlyCategory, friendlyMetric, friendlyWorkload, metricHelp, productHomepage } from "@/lib/friendly";
import { buildPrimedMessage, CHAT_TARGETS, personaDeepLink } from "@/lib/persona-use";
import { CopyFallback } from "@/components/copy-fallback";
import { WorkstyleCard } from "@/components/workstyle-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

const ruleGroupLabel: Record<"interaction_rules" | "response_rules" | "decision_rules" | "tool_rules", string> = {
  interaction_rules: "How it should work with you",
  response_rules: "How answers should look",
  decision_rules: "How it should help you decide",
  tool_rules: "How it should use tools",
};

export function ResultsView({
  result,
  sessionId,
  shareMode = false,
}: {
  result: ScoreResult;
  sessionId?: string;
  shareMode?: boolean;
}) {
  const router = useRouter();
  const { detailed } = useReadingLevel();
  const [current, setCurrent] = useState(result);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<"instructions" | "card" | "guide" | null>(null);
  const [activeInstall, setActiveInstall] = useState(current.install_guides?.[0]?.id ?? "chatgpt");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState<string | null>(null);
  const [filterNote, setFilterNote] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [task, setTask] = useState("");
  const [useToolId, setUseToolId] = useState("chatgpt");
  const [personaName, setPersonaName] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem("fit.personaName") ?? "";
    } catch {
      return "";
    }
  });
  const [primedCopied, setPrimedCopied] = useState(false);
  const [fallback, setFallback] = useState<{ text: string; label: string } | null>(null);
  const appleTouch = isAppleTouch();
  const actionClass = "min-h-11 w-full sm:w-auto";

  const workstyle = current.workstyle;
  const maturity = workstyle?.maturity;
  const stack = current.operating_stack?.length ? current.operating_stack : null;
  const routing = current.model_routing ?? [];
  const workflow = current.workflow ?? [];
  const guides = current.install_guides ?? [];
  const activeGuide = guides.find((guide) => guide.id === activeInstall) ?? guides[0];
  const topTool =
    (stack ?? [])[0]?.product?.name ?? current.primary_stack.slots[0]?.recommendation?.name ?? null;
  const firstGuide = guides[0];
  const useTarget = CHAT_TARGETS.find((item) => item.id === useToolId) ?? CHAT_TARGETS[0];
  const personaTitle = personaName.trim() || current.workstyle?.label || current.persona.label;

  async function applyFilters(nextLocal: boolean, nextPrice: string | null) {
    if (!sessionId) return;
    setFiltering(true);
    setFilterNote(null);
    try {
      const stored = loadSession(sessionId);
      const scored = stored
        ? await api.scoreFull(stored, { local_only: nextLocal, max_pricing_tier: nextPrice })
        : await api.score(sessionId, { local_only: nextLocal, max_pricing_tier: nextPrice });
      setCurrent(scored);
      saveResult(sessionId, scored);
    } catch (err) {
      setFilterNote(err instanceof Error ? err.message : "Could not re-rank with those filters.");
    } finally {
      setFiltering(false);
    }
  }

  async function download(target: string) {
    setExportNote(null);
    if (appleTouch && current.instructions) {
      const outcome = await copyText(current.instructions);
      if (outcome === "fallback") {
        setFallback({ text: current.instructions, label: "your setup" });
        return;
      }
      setCopied("instructions");
      setExportNote("Copied your setup — paste it into the app. iPhone does not download zip files well.");
      return;
    }
    try {
      const artifact = await api.exportPersona(target, current);
      const binary = artifact.encoding === "base64";
      const blob = binary
        ? new Blob([Uint8Array.from(atob(artifact.content), (char) => char.charCodeAt(0))])
        : new Blob([artifact.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = artifact.filename.split("/").pop() || artifact.filename;
      link.click();
      URL.revokeObjectURL(url);
      setExportNote(`Downloaded ${artifact.filename}`);
    } catch (err) {
      if (current.instructions) {
        const outcome = await copyText(current.instructions);
        if (outcome === "fallback") setFallback({ text: current.instructions, label: "your setup" });
        else setCopied("instructions");
        setExportNote("Download failed, so we copied the instructions instead.");
        return;
      }
      setExportNote(err instanceof Error ? err.message : "Export failed.");
    }
  }

  async function share() {
    let path = sessionId ? `/share/${sessionId}` : "/share/profile";
    let durable = false;
    try {
      const created = await api.publishShare(current);
      path = created.path;
      durable = Boolean(created.durable);
    } catch {
      if (sessionId) {
        try {
          const created = await api.share(sessionId);
          path = created.path;
          durable = Boolean(created.durable);
        } catch {
          // Hash fallback still works without server storage.
        }
      }
    }
    const encoded = await encodeSharePayload(current);
    const url = durable
      ? `${window.location.origin}${path}`
      : `${window.location.origin}${path}#${encoded}`;
    setShareUrl(url);
    const outcome = await shareOrCopy(url, workstyle?.label ?? current.persona.label);
    if (outcome === "fallback") setFallback({ text: url, label: "share link" });
  }

  async function copy(text: string, kind: "instructions" | "card" | "guide") {
    if (!text) return;
    const outcome = await copyText(text);
    if (outcome === "fallback") {
      setFallback({ text, label: kind });
      return;
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  function updatePersonaName(value: string) {
    setPersonaName(value);
    try {
      window.localStorage.setItem("fit.personaName", value);
    } catch {
      // Ignore storage failures; the name still applies for this visit.
    }
  }

  function flashPrimedCopied() {
    setPrimedCopied(true);
    window.setTimeout(() => setPrimedCopied(false), 2000);
  }

  async function usePersona() {
    const target = CHAT_TARGETS.find((item) => item.id === useToolId) ?? CHAT_TARGETS[0];
    const message = buildPrimedMessage(current, task, personaName);
    const outcome = await copyText(message);
    if (outcome === "fallback") setFallback({ text: message, label: "primed message" });
    else flashPrimedCopied();
    const url = personaDeepLink(target, message);
    if (url) window.open(url, "_blank", "noreferrer");
  }

  async function copyPrimed() {
    const message = buildPrimedMessage(current, task, personaName);
    const outcome = await copyText(message);
    if (outcome === "fallback") setFallback({ text: message, label: "primed message" });
    else flashPrimedCopied();
  }

  async function remove() {
    if (!sessionId) return;
    clearSession(sessionId);
    await api.deleteSession(sessionId).catch(() => undefined);
    router.push("/");
  }

  async function sendFeedback() {
    if (!rating) return;
    await api.feedback({ session_id: sessionId, rating, comment, useful: rating >= 4 });
    setFeedbackNote("Saved. The question that matters: did you install or change anything?");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <section className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
          {shareMode ? "A shared AI style" : "Your AI style"}
        </p>
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="max-w-2xl space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{workstyle?.label ?? current.persona.label}</h1>
            <p className="text-base text-muted-foreground sm:text-lg">{workstyle?.narrative ?? workstyle?.summary ?? current.persona.purpose}</p>
          </div>
          {maturity ? (
            <div className="w-full rounded-xl border px-4 py-3 text-left sm:w-auto sm:text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">MY AI score</p>
              <p className="text-3xl font-semibold">{maturity.score}</p>
              <p className="text-sm capitalize text-muted-foreground">{maturity.band}</p>
              <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground sm:ml-auto">
                How clearly your answers point to one way of using AI. Higher means clearer, not better.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {!shareMode ? (
        <section aria-labelledby="start-here" className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <h2 id="start-here" className="text-lg font-semibold">
            Start here
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Three steps to put this to work in the next few minutes:
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            <li>
              <span className="font-medium">1.</span> Copy your instructions below.
            </li>
            <li>
              <span className="font-medium">2.</span> Open{" "}
              <span className="font-medium">{topTool ?? "your main AI app"}</span>
              {firstGuide ? <span className="text-muted-foreground"> ({firstGuide.where})</span> : null}.
            </li>
            <li>
              <span className="font-medium">3.</span> Paste the instructions in and start using it.
            </li>
          </ol>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              className={actionClass}
              onClick={() => copy(current.instructions || "", "instructions")}
              disabled={!current.instructions}
            >
              {copied === "instructions" ? "Copied instructions" : "Copy my instructions"}
            </Button>
            <Link href="#use-persona" className={cn(buttonVariants({ variant: "outline" }), actionClass, "inline-flex")}>
              Use it now
            </Link>
            <Button className={actionClass} variant="outline" onClick={share}>
              Share this profile
            </Button>
            {!appleTouch ? (
              <Button className={actionClass} variant="outline" onClick={() => download("pack")}>
                Save my AI setup
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <Link href="/assessment" className={cn(buttonVariants(), actionClass, "inline-flex")}>
          Find your own fit
        </Link>
      )}

      <WorkstyleCard
        result={current}
        copied={copied === "card"}
        onCopy={shareMode ? undefined : () => copy(current.share_card || "", "card")}
      />

      <section aria-labelledby="use-persona" className="rounded-2xl border p-5">
        <h2 id="use-persona" className="text-lg font-semibold">
          Use your persona now
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Type something you actually need help with. MY AI adds your{" "}
          <span className="font-medium text-foreground">{personaTitle}</span> style and hands it to the AI you pick —
          ready to send.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <label htmlFor="persona-name" className="text-sm font-medium">
              Name this setup (optional)
            </label>
            <input
              id="persona-name"
              value={personaName}
              onChange={(event) => updatePersonaName(event.target.value)}
              placeholder={current.workstyle?.label ?? "My AI setup"}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring"
            />
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <label htmlFor="persona-task" className="text-sm font-medium">
            What do you need help with?
          </label>
          <Textarea
            id="persona-task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="e.g. Draft a friendly reply to this email, or plan my week around three priorities."
          />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Send it to</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an AI">
            {CHAT_TARGETS.map((target) => (
              <Button
                key={target.id}
                size="sm"
                variant={useToolId === target.id ? "default" : "outline"}
                aria-pressed={useToolId === target.id}
                onClick={() => setUseToolId(target.id)}
              >
                {target.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className={actionClass} onClick={usePersona} disabled={!task.trim()}>
            {useTarget.base ? `Open in ${useTarget.label}` : "Copy for any AI"}
          </Button>
          <Button className={actionClass} variant="outline" onClick={copyPrimed} disabled={!task.trim()}>
            {primedCopied ? "Copied message" : "Copy primed message"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing is sent to MY AI — your message goes to the AI you choose. For Gemini and “Any AI” we copy it so you can
          paste it in.
        </p>
      </section>

      {workstyle?.why?.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Why we think that</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {workstyle.why.map((reason) => (
              <Card key={reason.dimension}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{reason.dimension}</CardTitle>
                    <span className="text-sm text-muted-foreground">{reason.score}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{reason.text}</p>
                  {reason.evidence?.length ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {reason.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {workstyle?.dimensions?.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">How you like to use AI</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {workstyle.dimensions.map((dimension) => (
              <Card key={dimension.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{dimension.label}</CardTitle>
                    <span className="text-sm font-medium">{dimension.display ?? Math.round(dimension.score * 100)}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress value={(dimension.display ?? dimension.score * 100)} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tools that fit you</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(stack ?? current.primary_stack.slots.map((slot) => ({
            role: slot.category,
            label: friendlyCategory(slot.category),
            handles: undefined,
            product: slot.recommendation,
          }))).map((slot) => (
            <Card key={slot.role}>
              <CardHeader>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {friendlyCategory(slot.role)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{slot.product?.name ?? "No strong match yet"}</CardTitle>
                  {slot.product && productHomepage(slot.product.id) ? (
                    <a
                      href={productHomepage(slot.product.id)!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {slot.handles ? <p>{slot.handles}</p> : null}
                {slot.product ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {pct(slot.product.fit)} fit
                    </span>
                    {detailed && slot.product.last_evaluated_at ? (
                      <span className="text-xs">checked {slot.product.last_evaluated_at}</span>
                    ) : null}
                  </div>
                ) : (
                  <p>This role stayed empty under the current filters.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {routing.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What to use each model for</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {routing.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{row.work}</p>
                    {row.handles ? <p className="text-muted-foreground">{row.handles}</p> : null}
                  </div>
                  <span className="text-muted-foreground">{cleanModelName(row.model?.name)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {workflow.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">A simple way to work</h2>
          <div className="grid gap-3 md:grid-cols-5">
            {workflow.map((step) => (
              <Card key={step.id} className={step.emphasis ? "border-primary/50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{step.label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{step.instruction}</CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How your AI should talk to you</h2>
        <Card>
          <CardHeader>
            <CardTitle>{current.persona.label}</CardTitle>
            <p className="text-sm text-muted-foreground">{current.persona.purpose}</p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {current.persona.traits?.length ? (
              <div className="flex flex-wrap gap-2">
                {current.persona.traits.map((trait) => (
                  <Badge key={trait} variant="secondary">
                    {trait}
                  </Badge>
                ))}
              </div>
            ) : null}
            {(["interaction_rules", "response_rules", "decision_rules", "tool_rules"] as const).map((key) => (
              <div key={key}>
                <p className="mb-1 font-medium">{ruleGroupLabel[key]}</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {current.persona[key].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="setup" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Set up your apps</h2>
          <p className="text-sm text-muted-foreground">Paste into ChatGPT, Claude, Cursor, Gemini, or an agent.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {guides.map((guide) => (
            <Button key={guide.id} size="sm" variant={activeGuide?.id === guide.id ? "default" : "outline"} onClick={() => setActiveInstall(guide.id)}>
              {guide.label}
            </Button>
          ))}
        </div>
        {activeGuide ? (
          <Card>
            <CardHeader>
              <CardTitle>Set up {activeGuide.label}</CardTitle>
              <p className="text-sm text-muted-foreground">{activeGuide.where}</p>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {activeGuide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button className={actionClass} onClick={() => copy(current.instructions || "", "guide")} disabled={!current.instructions}>
                  {copied === "guide" ? "Copied" : "Copy instructions"}
                </Button>
                {!appleTouch ? (
                  <>
                    <Button className={actionClass} variant="outline" onClick={() => download(activeGuide.export_target)}>
                      Download {activeGuide.filename.split("/").pop()}
                    </Button>
                    <Button className={actionClass} variant="outline" onClick={() => download("pack")}>
                      Download all files
                    </Button>
                  </>
                ) : null}
              </div>
              {exportNote ? <p className="text-muted-foreground">{exportNote}</p> : null}
            </CardContent>
          </Card>
        ) : null}
      </section>

      <details className="rounded-xl border px-4 py-3" open={detailed}>
        <summary className="cursor-pointer text-sm font-medium">
          How we scored this
          <span className="ml-2 font-normal text-muted-foreground">
            {detailed ? "— the full breakdown" : "— open for the full breakdown"}
          </span>
        </summary>
        <div className="mt-4 space-y-6">
          {!shareMode && sessionId ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Optional filters re-rank the same answers. Nothing is guessed.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={localOnly ? "default" : "outline"}
                  disabled={filtering}
                  onClick={() => {
                    const next = !localOnly;
                    setLocalOnly(next);
                    void applyFilters(next, maxPrice);
                  }}
                >
                  Local only
                </Button>
                {(["low", "mixed", "high"] as const).map((tier) => (
                  <Button
                    key={tier}
                    size="sm"
                    variant={maxPrice === tier ? "default" : "outline"}
                    disabled={filtering}
                    onClick={() => {
                      const next = maxPrice === tier ? null : tier;
                      setMaxPrice(next);
                      void applyFilters(localOnly, next);
                    }}
                  >
                    Max {tier} cost
                  </Button>
                ))}
              </div>
              {filtering ? <p className="text-muted-foreground">Re-ranking…</p> : null}
              {filterNote ? <p className="text-destructive">{filterNote}</p> : null}
            </div>
          ) : null}
          <Tabs defaultValue="evidence">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="products">All products</TabsTrigger>
              <TabsTrigger value="models">All models</TabsTrigger>
            </TabsList>
            <TabsContent value="evidence" className="space-y-4">
              {current.metrics.map((metric) => (
                <Card key={`ev-${metric.name}`}>
                  <CardHeader>
                    <CardTitle>
                      {friendlyMetric(metric.name)}
                      {detailed ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{metric.name}</span>
                      ) : null}
                    </CardTitle>
                    {metricHelp(metric.name) ? (
                      <p className="text-sm text-muted-foreground">{metricHelp(metric.name)}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>
                      {metric.observations} observations across {metric.scenario_ids.join(", ") || "no scenarios"}.
                      {detailed ? ` Confidence ${pct(metric.confidence)}.` : ""}
                    </p>
                    <Progress className="my-2" value={metric.score * 100} />
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {metric.evidence.length ? metric.evidence.map((item) => <li key={item}>{item}</li>) : <li>No quoted evidence for this metric.</li>}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
            <TabsContent value="products" className="space-y-6">
              {Object.entries(current.products_by_category).map(([category, recs]) => (
                <div key={category} className="space-y-3">
                  <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {friendlyCategory(category)}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {recs.map((product) => (
                      <Card key={product.id}>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-3">
                            <CardTitle>{product.name}</CardTitle>
                            <Badge>{pct(product.fit)}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <p>Evaluated {product.last_evaluated_at}</p>
                          <p>Helps: {product.positive_factors.join(", ") || "n/a"}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="models" className="space-y-4">
              {Object.entries(current.models).map(([workload, recs]) => (
                <Card key={workload}>
                  <CardHeader>
                    <CardTitle>{friendlyWorkload(workload)}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {recs.slice(0, 3).map((model) => (
                      <div key={model.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>{cleanModelName(model.name)}</span>
                        <span className="text-muted-foreground">{pct(model.fit)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      </details>

      {!shareMode && sessionId ? (
        <Card>
          <CardHeader>
            <CardTitle>Share or delete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button className={actionClass} onClick={share}>
                Copy share link
              </Button>
              {!appleTouch ? (
                <Button className={actionClass} variant="outline" onClick={() => download("pack")}>
                  Export zip
                </Button>
              ) : null}
              <Button className={actionClass} variant="destructive" onClick={remove}>
                Delete this session
              </Button>
            </div>
            {shareUrl ? (
              <p>
                Share URL copied:{" "}
                <Link className="underline" href={shareUrl}>
                  {shareUrl}
                </Link>
              </p>
            ) : null}
            <div className="space-y-2">
              <p className="font-medium">Did this actually help you use AI?</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Button key={value} variant={rating === value ? "default" : "outline"} size="sm" onClick={() => setRating(value)}>
                    {value}
                  </Button>
                ))}
              </div>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Optional. Did you install a file, switch a tool, or change a workflow?" />
              <Button variant="outline" onClick={sendFeedback} disabled={!rating}>
                Send feedback
              </Button>
              {feedbackNote ? <p className="text-muted-foreground">{feedbackNote}</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {fallback ? <CopyFallback text={fallback.text} label={fallback.label} onClose={() => setFallback(null)} /> : null}
    </div>
  );
}
