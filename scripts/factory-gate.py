#!/usr/bin/env python3
"""Step 4 - Ship. The gate. See factory/04-SHIP.md.

    python3 scripts/factory-gate.py <slug>

This is deliberately not a structural gate. A gate that only checks whether files
exist passes for a feature that does not compile, and a gate that passes when it
is unconfigured is not a gate. So: it runs the repo's own commands from
factory.config.json, and it fails when that file is absent rather than waving the
work through.

Exit codes: 0 pass, 1 one or more checks failed, 2 usage or configuration error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"sk-ant-[A-Za-z0-9\-_]{20,}", "Anthropic API key"),
    (r"sk-[A-Za-z0-9]{32,}", "OpenAI-style API key"),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub personal access token"),
    (r"github_pat_[A-Za-z0-9_]{22,}", "GitHub fine-grained token"),
    (r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----", "private key"),
    (r"(?i)(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"\s]{8,}['\"]",
     "hardcoded credential"),
]

# Placeholders the templates ship with. Any survivor means the document was
# scaffolded and never filled in, which is the failure mode this catches. Kept
# to markers that cannot occur in real prose — an ellipsis would false-positive
# on the first honest sentence someone writes.
UNFILLED = ["TODO", "FILL IN"]

# Same rule as scripts/factory-new.sh. The slug becomes a path segment and a git
# ref below, so anything else (../, spaces, leading dashes) is refused before use.
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Text artefacts in evidence/<slug>/ that are scanned for secrets. Binary
# captures (png, mp4) cannot be grepped meaningfully and are skipped.
SCANNED_SUFFIXES = {".md", ".txt", ".log", ".json", ".tsv", ".csv", ".yml", ".yaml", ".har"}


class Result:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passes: list[str] = []

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        if ok:
            self.passes.append(label)
        else:
            self.failures.append(f"{label}{': ' + detail if detail else ''}")
        return ok


def run(cmd: str, cwd: Path) -> tuple[int, str]:
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)[-2000:]


def latest_score(review: str):
    """Rubric rounds are appended, so the last round heading in the file is current.

    Only round headings count. Scanning the whole document for `n/5` would let a
    closing sentence like "nothing merges below 5/5" pass the gate, which is the
    exact opposite of what that sentence says.
    """
    found = re.findall(r"^#+\s*Round\b.*?(\d)\s*/\s*5", review, re.M | re.I)
    return int(found[-1]) if found else None


def round_blocks(review: str) -> list[str]:
    """Split REVIEW.md into its round blocks, oldest first."""
    starts = [m.start() for m in re.finditer(r"^#+\s*Round\b", review, re.M | re.I)]
    return [review[a:b] for a, b in zip(starts, starts[1:] + [len(review)])]


def reviewer_of(block: str):
    """The `Reviewer:` signature in a round block, or None if absent/placeholder.

    The signature names who (or which clean-context reviewer session) scored the
    round. It is what makes "the builder did not review its own work" checkable
    after the fact; a round nobody signed cannot be attributed and does not count.
    """
    m = re.search(r"^\s*\**Reviewer:\**\s*(.*?)\s*$", block, re.M | re.I)
    if not m:
        return None
    who = m.group(1).strip("* ")
    if not who or who.startswith("<") or any(u in who for u in UNFILLED):
        return None
    return who


def scan_secrets(text: str) -> list[str]:
    return [label for pat, label in SECRET_PATTERNS if re.search(pat, text)]


def git_ok(args: list[str], cwd: Path) -> bool:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True).returncode == 0


def unresolved_severity(security: str) -> list[str]:
    """Critical/high findings that have not been marked resolved or none.

    A security review that found nothing still writes the severity headings down,
    so the presence of the word is not the signal — the presence of a finding
    under it is.
    """
    out = []
    for line in security.splitlines():
        m = re.match(r"^\s*[-*|#]*\s*\**(critical|high)\b", line, re.I)
        if m and not re.search(r"\b(none|n/a|resolved|no findings)\b", line, re.I):
            out.append(line.strip()[:120])
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python3 scripts/factory-gate.py <slug>", file=sys.stderr)
        return 2

    slug = sys.argv[1]
    if not SLUG_RE.match(slug):
        print("slug must be kebab-case: [a-z0-9] separated by single hyphens",
              file=sys.stderr)
        return 2
    root = Path(subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True).stdout.strip())

    spec = root / "specs" / f"{slug}.md"
    ev = root / "evidence" / slug
    wt = root / "worktrees" / slug
    r = Result()

    # --- spec -------------------------------------------------------------
    if r.check(spec.exists(), "spec exists", str(spec)):
        text = spec.read_text()
        r.check("Spec not written yet" not in text and len(text) > 200,
                "spec is written", "stub or near-empty")
        r.check("## Acceptance criteria" in text,
                "spec has acceptance criteria", "no '## Acceptance criteria' heading")
        left = [m for m in UNFILLED if m in text]
        r.check(not left, "spec is filled in",
                "unfilled placeholders: " + ", ".join(left))
        # A station may not be built in against a draft; see agents/builder.md.
        r.check("**Status:** APPROVED" in text or "Status: APPROVED" in text,
                "spec is approved", "status is not APPROVED")

    # --- evidence ---------------------------------------------------------
    if r.check(ev.is_dir(), "evidence directory exists", str(ev)):
        captures = ev / "captures.tsv"
        phases = set()
        if captures.exists():
            phases = {line.split("\t")[0] for line in
                      captures.read_text().splitlines() if line.strip()}
        r.check("before" in phases, "before state captured",
                "run scripts/factory-prove.sh <slug> before, before editing")
        r.check("after" in phases, "after state captured")

        artefacts = [p for p in ev.iterdir()
                     if p.suffix.lower() in
                     {".png", ".jpg", ".jpeg", ".gif", ".mp4", ".mov", ".txt", ".log", ".json"}]
        befores = [p for p in artefacts if p.stem.startswith("before")]
        afters = [p for p in artefacts if p.stem.startswith("after")]
        r.check(bool(befores), "before artefact present",
                "expected evidence/%s/before.* " % slug)
        r.check(bool(afters), "after artefact present",
                "expected evidence/%s/after.*" % slug)

        doc = ev / "EVIDENCE.md"
        if r.check(doc.exists(), "EVIDENCE.md exists"):
            t = doc.read_text()
            left = [m for m in UNFILLED if m in t]
            r.check(not left, "EVIDENCE.md is filled in",
                    "unfilled placeholders: " + ", ".join(left))
            r.check("does not prove" in t.lower(),
                    "EVIDENCE.md states what it does not prove",
                    "the honest-limit line is required; see factory/03-PROVE.md")

        # --- review -------------------------------------------------------
        rev = ev / "REVIEW.md"
        if r.check(rev.exists(), "REVIEW.md exists", "the feature has not been reviewed"):
            review = rev.read_text()
            s = latest_score(review)
            r.check(s is not None, "REVIEW.md records a score", "no 'n/5' found")
            if s is not None:
                r.check(s == 5, "review score is 5/5", f"latest round scored {s}/5")
            blocks = round_blocks(review)
            r.check(bool(blocks) and reviewer_of(blocks[-1]) is not None,
                    "latest review round is signed",
                    "add a 'Reviewer: <who>' line to the latest round; see factory/RUBRIC.md")

        # Security review is required only under the governance layer; when the
        # file exists, an unresolved critical or high finding blocks regardless
        # of the rubric score. See agents/security-reviewer.md.
        sec = ev / "SECURITY.md"
        if sec.exists():
            hits = unresolved_severity(sec.read_text())
            r.check(not hits, "no unresolved critical/high security finding",
                    "; ".join(hits[:3]) or "see evidence/%s/SECURITY.md" % slug)

    # --- the repo's own checks -------------------------------------------
    cfg_path = root / "factory.config.json"
    if not cfg_path.exists():
        print("factory.config.json is missing. The gate will not pass unconfigured.\n"
              "Create it at the repo root:\n\n"
              '  {"checks": {"typecheck": "npm run typecheck", "test": "npm run test"}}\n',
              file=sys.stderr)
        return 2

    checks = json.loads(cfg_path.read_text()).get("checks", {})
    if not checks:
        print("factory.config.json declares no checks. See factory/04-SHIP.md.",
              file=sys.stderr)
        return 2

    where = wt if wt.is_dir() else root
    for name, cmd in checks.items():
        code, out = run(cmd, where)
        r.check(code == 0, f"check: {name}", f"`{cmd}` exited {code}\n{out}")

    # --- secrets in the diff and in the evidence ---------------------------
    # Diff against the fetched base when there is one: a stale local base makes
    # `base...feature` include commits that are already merged, while the point
    # is to scan exactly what this feature adds. The feature ref is the slug
    # branch when it exists locally (ship runs from the root checkout), else
    # HEAD (cloud mode, where the station is the checkout). A diff that cannot
    # be produced fails the gate — an unscanned diff is not a clean one.
    base_branch = os.environ.get("FACTORY_BASE_BRANCH", "main")
    head = slug if git_ok(["rev-parse", "--verify", "--quiet", f"refs/heads/{slug}"], root) else "HEAD"
    candidates = [f"origin/{base_branch}", base_branch]
    base = next((c for c in candidates
                 if git_ok(["rev-parse", "--verify", "--quiet", c], root)), None)
    if r.check(base is not None, "base branch resolves for the secret scan",
               f"neither {' nor '.join(candidates)} exists; set FACTORY_BASE_BRANCH"):
        d = subprocess.run(["git", "diff", f"{base}...{head}"], cwd=root,
                           capture_output=True, text=True, errors="replace")
        if r.check(d.returncode == 0, "secret scan diff produced",
                   f"`git diff {base}...{head}` exited {d.returncode}: {d.stderr.strip()[:300]}"):
            hits = scan_secrets(d.stdout)
            r.check(not hits, "no secrets in the diff", ", ".join(hits))

    # The spec and evidence are committed onto the base branch by
    # factory-ship.sh, outside the feature diff, so they are scanned directly.
    # A pasted curl with a live bearer token in after.txt is the usual leak.
    scanned = [spec] if spec.exists() else []
    if ev.is_dir():
        scanned += sorted(p for p in ev.rglob("*")
                          if p.is_file() and p.suffix.lower() in SCANNED_SUFFIXES)
    leaks = []
    for p in scanned:
        hits = scan_secrets(p.read_text(errors="replace"))
        if hits:
            leaks.append(f"{p.relative_to(root)} ({', '.join(hits)})")
    r.check(not leaks, "no secrets in spec or evidence", "; ".join(leaks[:5]))

    # --- report -----------------------------------------------------------
    print(f"\nfactory gate — {slug}\n")
    for p in r.passes:
        print(f"  pass  {p}")
    for f in r.failures:
        print(f"  FAIL  {f}")

    if r.failures:
        print(f"\n{len(r.failures)} failing. Nothing merges. See factory/04-SHIP.md.\n")
        return 1

    print(f"\nall {len(r.passes)} checks pass — clear to ship\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
