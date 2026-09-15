#!/usr/bin/env bash
# Push this build pack to a new GitHub repo so Cursor can clone it.
#
#   cd ~/Desktop/AI_Fit_Engine_Build_Pack
#   bash scripts/push_to_github.sh [repo-name] [public|private]
#
# The local git repo and first commit already exist. This only creates the
# remote and pushes.

set -euo pipefail

REPO_NAME="${1:-ai-fit-engine}"
VISIBILITY="${2:-private}"

cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "No .git here. Run this from inside the build pack folder." >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "A remote named 'origin' already exists:"
  git remote -v
  echo "Pushing to it instead of creating a new repo."
  git push -u origin main
  exit 0
fi

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "GitHub CLI is installed but not logged in. Running 'gh auth login'..."
    gh auth login
  fi
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
  echo
  echo "Done. Clone URL for Cursor:"
  gh repo view "$REPO_NAME" --json sshUrl,url --jq '.url, .sshUrl'
else
  cat <<EOF

GitHub CLI ('gh') is not installed. Two options:

1. Install it, then re-run this script:
     brew install gh
     bash scripts/push_to_github.sh $REPO_NAME $VISIBILITY

2. Or create the repo by hand at https://github.com/new
   (name it "$REPO_NAME", do NOT add a README or .gitignore), then:
     git remote add origin git@github.com:<your-username>/$REPO_NAME.git
     git push -u origin main

EOF
  exit 1
fi
