import Link from 'next/link';

export const metadata = {
  title: 'How it works — Fit',
  description: 'Six questions, one engine, a verdict that is allowed to be no.',
};

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">How it works</p>
      <h1 className="text-3xl font-semibold tracking-tight">Six questions, one engine</h1>
      <p className="text-muted-foreground">
        Fit here is the consumer aperture of ARK. The same engine that scores a thirty-question team intake scores
        these six answers. The six are widened into a full workload with conservative defaults — modest volume, some
        data sensitivity, unexceptional team capability — so a consumer verdict is allowed to be too cautious and is
        not allowed to be too encouraging.
      </p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>What is the task, in a sentence?</li>
        <li>What kind of work is it? Maths and looking-up-a-known-answer are what trigger a no.</li>
        <li>Exactly right, or approximately right?</li>
        <li>What happens if it is wrong?</li>
        <li>Does it need information from somewhere else?</li>
        <li>Does it just produce an answer, or does it do something?</li>
      </ol>
      <p className="text-muted-foreground">
        Every number on the result carries a basis tag: heuristic, benchmark, calibrated, or measured. A guess and a
        measurement should never look the same on screen. This surface does not fetch calibration, so figures here
        stay heuristic.
      </p>
      <p className="text-sm text-muted-foreground">
        <Link href="/assess" className="text-primary underline underline-offset-2">
          Try it
        </Link>
      </p>
    </div>
  );
}
