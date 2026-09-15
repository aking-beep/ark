'use client';

import { useState } from 'react';
import { copyHref } from './copy-href';

export function CopyResultLink() {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    await copyHref(navigator.clipboard, window.location.href);
    setCopied(true);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-100 transition hover:border-ink-500 hover:bg-ink-800"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className="max-w-md text-2xs leading-relaxed text-ink-500">
        This link contains your answers. Nothing is stored on a server — anyone you send it to can read what you typed.
      </p>
    </div>
  );
}
