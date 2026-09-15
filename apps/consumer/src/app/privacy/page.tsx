import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="text-muted-foreground">
        MY AI runs in anonymous mode. It does not ask for your name, employer, or demographic attributes, and it
        does not infer protected characteristics.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>What is stored</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>A random session ID, interaction events, optional free text, and derived scores live in memory on the API process.</p>
          <p>Share links store a score snapshot without your notes unless those notes already became evidence strings.</p>
          <p>Feedback stores a 1–5 rating and an optional comment. Do not include identifying details.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delete and export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>From results, export the session or delete it. Deletion drops events and scores for that ID.</p>
          <p>Your answers stay in this browser until you delete the session. There is no account database.</p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        One limitation, stated once: this is not a personality test, clinical tool, or hiring screen.
      </p>
    </div>
  );
}
