"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export function CopyFallback({
  text,
  label,
  onClose,
}: {
  text: string;
  label: string;
  onClose: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [text]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-fallback-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-lg rounded-2xl bg-background p-5 shadow-lg">
        <h2 id="copy-fallback-title" className="text-lg font-semibold">
          Copy {label}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This browser blocked automatic copy. Tap the box, then copy.
        </p>
        <textarea
          ref={areaRef}
          readOnly
          value={text}
          className="mt-3 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        />
        <div className="mt-4 flex justify-end">
          <Button className="min-h-11" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
