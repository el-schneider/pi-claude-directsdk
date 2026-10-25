#!/usr/bin/env bash
# Rebase the fork's commits onto joaomj/pi-claude-directsdk and push.
#
# Stops on a rebase conflict or a failed check. The message comparison needs
# a logged-in `claude` CLI and makes no paid request.
set -euo pipefail
cd "$(dirname "$0")/.."

git remote get-url upstream >/dev/null 2>&1 ||
  git remote add upstream https://github.com/joaomj/pi-claude-directsdk.git
[[ -z $(git status --porcelain) ]] || { echo "working tree is not clean" >&2; exit 1; }
git checkout -q main
git fetch -q upstream
if git merge-base --is-ancestor upstream/main HEAD; then
  echo "already on top of upstream/main"
  exit 0
fi
git log --oneline HEAD..upstream/main
git rebase upstream/main
npm ci --ignore-scripts --silent
npm run check
npm test
node scripts/compare-messages.mjs
git push --force-with-lease origin main
echo "synced. Run: pi update git:github.com/el-schneider/pi-claude-directsdk"
