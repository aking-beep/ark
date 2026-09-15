'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Wizard } from '@/components/wizard';

export default function Assess() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">About a minute</p>
        <h1 className="text-3xl font-semibold tracking-tight">Should you use AI for this</h1>
        <p className="text-muted-foreground">
          Six questions about one specific task. You leave with a verdict — including when the answer is no — and a
          link you can copy. Nothing is stored.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>One task, not a survey of your job.</li>
          <li>Anonymous: no name, email, or account.</li>
          <li>The answers live in the result URL, not on a server.</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          We do not ask for an email. Read the{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy note
          </Link>{' '}
          anytime.
        </p>
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:w-auto"
        >
          Let&apos;s go
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Wizard />
    </div>
  );
}
