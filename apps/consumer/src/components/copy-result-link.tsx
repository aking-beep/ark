'use client';

import { useState } from 'react';
import { copyHref } from './copy-href';

export function CopyResultLink() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    try {
      await copyHref(navigator.clipboard, window.location.href);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/50"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className="max-w-md text-2xs leading-relaxed text-muted-foreground">
        This link contains your answers. Nothing is stored on a server — anyone you send it to can read what you typed.
      </p>
      {failed && (
        <p className="w-full text-2xs leading-relaxed text-destructive">
          Could not copy automatically. Select the address bar and copy the URL by hand.
        </p>
      )}
    </div>
  );
}
