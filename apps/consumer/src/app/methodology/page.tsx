import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-primary">In plain language</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-4 text-muted-foreground">
        MY AI watches what you ask for — a source, a comparison, a quick answer, or a hands-off helper — then matches
        that to a dated list of products and models. A chat model may label extra notes. It never picks the winner.
      </p>

      <section className="mt-10 space-y-8 text-sm leading-6">
        <div>
          <h2 className="text-lg font-semibold">1. Short scenes, not a personality test</h2>
          <p className="mt-2 text-muted-foreground">
            Each choice becomes a simple signal. Those signals turn into a 0–1 picture of how you like to use AI, with
            confidence from how often we saw it. The ranking is math, not a vibe.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">2. Products and models stay separate</h2>
          <p className="mt-2 text-muted-foreground">
            Apps and models are different catalogs. Every public row has a last-checked date. Stale rows lose
            confidence; they are not marked “bad.”
          </p>
          <p className="mt-2">
            <Link href="/registry" className="underline underline-offset-4">
              Open the product and model registry
            </Link>
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">3. You can see why</h2>
          <p className="mt-2 text-muted-foreground">
            Results quote the choices that drove each dimension. MY AI is similarity, not a scientific probability. You
            can save or delete the session from your results page.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">4. Version</h2>
          <p className="mt-2 text-muted-foreground">
            MY AI 0.4. Usually four scenes (about five minutes), continuing only when a core habit still is not clear.
            Scoring stays on the server. Catalog last reviewed 12 September 2026.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">5. Limits</h2>
          <p className="mt-2 text-muted-foreground">
            Scores are not scientifically validated. This is not a personality test, clinical tool, or hiring screen.
            Do not use it that way.
          </p>
        </div>
      </section>

      <div className="mt-10">
        <Link href="/assessment" className={cn(buttonVariants(), "min-h-11 inline-flex")}>
          Find MY AI
        </Link>
      </div>
    </div>
  );
}
