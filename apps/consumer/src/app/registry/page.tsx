"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  last_evaluated_at: string;
  provider: string;
};

type Model = {
  id: string;
  name: string;
  family: string;
  last_evaluated_at: string;
  workload_scores: Record<string, number>;
};

function formatReviewed(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function RegistryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [needsReview, setNeedsReview] = useState(0);
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.products(), api.models(), api.freshness()])
      .then(([p, m, fresh]) => {
        setProducts(p as Product[]);
        setModels(m as Model[]);
        setNeedsReview((fresh.needs_review as { id: string }[]).length);
        setLastReviewed(typeof fresh.last_reviewed === "string" ? fresh.last_reviewed : null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load registry."))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-destructive">{error}</div>;
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-muted-foreground">Loading registry…</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Transparency</p>
        <h1 className="text-3xl font-semibold tracking-tight">Product and model registry</h1>
        <p className="max-w-3xl text-muted-foreground">
          Catalog used by the ranker. Most people never need this page — it exists so scoring is inspectable.
          Product ≠ model. Last reviewed {lastReviewed ? formatReviewed(lastReviewed) : "from each row's last_evaluated_at"}.
          {needsReview ? ` ${needsReview} records currently need a freshness review.` : " All dates currently sit inside the freshness window."}
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        {products.map((product) => (
          <Card key={product.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{product.name}</CardTitle>
                <Badge variant="secondary">{product.category.replaceAll("_", " ")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{product.description}</p>
              <p>
                {product.provider} · evaluated {product.last_evaluated_at}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-medium">Models</h2>
        {models.map((model) => (
          <Card key={model.id}>
            <CardHeader>
              <CardTitle>{model.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                {model.family} · evaluated {model.last_evaluated_at}
              </p>
              <p className="mt-2">
                {Object.entries(model.workload_scores)
                  .map(([k, v]) => `${k.replaceAll("_", " ")} ${Math.round(v * 100)}%`)
                  .join(" · ")}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
