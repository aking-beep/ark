import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="text-muted-foreground">
        AI Fit runs in anonymous mode. It does not ask for your name, employer, or demographic attributes, and it
        does not infer protected characteristics.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>What is stored</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            A random session ID, your answers (interaction events and any notes you typed), and the derived scores are
            saved on the AI Fit server: in Redis when the deployment has it configured, otherwise as files on the
            server&apos;s disk. Every record expires automatically after 30 days.
          </p>
          <p>
            Share links store a score snapshot (your profile, scores, and recommendations) for 30 days. They do not
            include your notes unless a note already became an evidence string. If the server cannot store the share,
            the link carries the snapshot itself after the <code>#</code>, which browsers do not send to the server.
          </p>
          <p>
            Feedback stores a 1–5 rating and an optional comment in server memory only (it is not written to disk and
            is lost on restart). Do not include identifying details. Anonymous usage counters are kept the same way.
          </p>
          <p>This browser also keeps a copy of your answers and results in local storage so the results page works offline.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delete and export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>From results, export the session or delete it.</p>
          <p>
            Delete removes, on the server: the session&apos;s answers, its scores, and every share link created from it.
            It also removes the session ID from feedback and usage counters. In this browser it clears the saved copy.
          </p>
          <p>
            Share links that only carry the snapshot after the <code>#</code> live in the link itself, so anyone who
            already has the link can still open it. There is no account database.
          </p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        One limitation, stated once: this is not a personality test, clinical tool, or hiring screen.
      </p>
    </div>
  );
}
