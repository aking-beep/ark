"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { saveResult, saveSession } from "@/lib/session-store";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Compass, FileDown, Sparkles } from "lucide-react";
import { businessUrl } from "@/lib/ark-links";

const audiences = ["Homework", "Home life", "Shop or studio", "Side hustle", "Small team"];

const steps = [
  {
    icon: Compass,
    title: "1. Play a few short scenes",
    body: "Four short scenes, about twelve questions — usually five minutes.",
  },
  {
    icon: Sparkles,
    title: "2. See your AI style",
    body: "Get a plain-language profile of how you like to ask, check, and decide — with the reasons.",
  },
  {
    icon: FileDown,
    title: "3. Get setup files",
    body: "Copy-paste instructions and matched tools for ChatGPT, Claude, Gemini, Cursor, and agents.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  async function runDemo() {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const demo = await api.demoSession();
      saveSession(demo.session);
      saveResult(demo.session_id, demo.result);
      router.push(`/results/${demo.session_id}`);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "Could not load the example.");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-8rem] h-80 w-80 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-48 -left-24 h-72 w-72 rounded-full bg-accent blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12">
        <section className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">For everyday people</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Find the AI that fits you.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Five lively minutes. No résumé, no corporate form. Fit watches how you ask, check, and decide — then gives
            you a setup you can paste into ChatGPT, Claude, Gemini, Cursor, or an agent.
          </p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Brand new to AI or using it every day? It works for both — switch between <strong>Simple</strong> and{" "}
            <strong>Detailed</strong> anytime with the toggle at the top. About 5 minutes · free · no sign-up · anonymous.
          </p>
          <div className="flex flex-wrap gap-2">
            {audiences.map((label) => (
              <span
                key={label}
                className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/assessment" className={cn(buttonVariants({ size: "lg" }), "min-h-11")}>
              Find my fit
            </Link>
            <Button size="lg" variant="outline" onClick={runDemo} disabled={demoLoading}>
              {demoLoading ? "Loading example…" : "See an example"}
            </Button>
          </div>
          {demoError ? (
            <p className="text-sm text-destructive" role="alert">
              {demoError}
            </p>
          ) : null}
        </section>
        <section aria-labelledby="how-it-works" className="space-y-4">
          <h2 id="how-it-works" className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            How it works
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <Card key={step.title} className="h-full">
                <CardHeader className="space-y-2">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle className="text-base">{step.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Your style, not a type</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Two neighbors can use the same app and still need different settings. Fit notices whether you want
              sources, a quick answer, or something you can tweak.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tools that match real life</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Homework, a shop, a studio, or a small team all count. You get a helper for everyday questions, looking
              things up, making stuff, and keeping private work on your device.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Built on today&apos;s tools</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Matched against a dated catalog of current apps and models — Claude, ChatGPT, Gemini, and more — each with
              a last-checked date you can inspect.
            </CardContent>
          </Card>
        </section>

        <section className="rounded-xl border border-border/80 p-6">
          <h2 className="text-base font-semibold">Assessing a team workload?</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Fit is for one person. AIFit for teams takes one repeating job and returns a verdict, an
            architecture, a cost, and a kill criterion — including no.
          </p>
          <a href={businessUrl} className={cn(buttonVariants({ variant: "outline" }), "mt-4 inline-flex min-h-11")}>
            AIFit for teams
          </a>
        </section>
      </div>
    </div>
  );
}
