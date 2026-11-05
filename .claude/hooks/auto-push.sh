#!/bin/bash
# Runs when Claude finishes a turn: commits whatever changed and pushes it to
# GitHub. Never force-pushes. Refuses to commit anything that looks like a secret.

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

say() {
  node -e 'console.log(JSON.stringify({ systemMessage: process.argv[1] }))' "GitHub: $1"
  exit 0
}

branch=$(git symbolic-ref --short -q HEAD) || exit 0

gitdir=$(git rev-parse --git-dir)
if [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ] || [ -f "$gitdir/MERGE_HEAD" ]; then
  say "not pushed, a merge or rebase is in progress."
fi

git add -A

if ! git diff --cached --quiet; then
  # Secret files, by name. .env.example holds no values, so it is fine.
  bad_files=$(git diff --cached --name-only --diff-filter=d \
    | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|(^|/)id_(rsa|ed25519)$' \
    | grep -v '\.env\.example$')
  # Secret values, in the lines being added. This script names the patterns itself.
  bad_lines=$(git diff --cached -U0 -- . ':!.claude/hooks/auto-push.sh' \
    | grep -E '^\+' \
    | grep -cE 'eyJ[A-Za-z0-9_-]{30,}\.|sk-ant-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?://[^:[:space:]]+:[^@[:space:]]+@')

  if [ -n "$bad_files" ] || [ "$bad_lines" != "0" ]; then
    git reset -q
    say "nothing committed or pushed, this may contain a secret: ${bad_files:-$bad_lines added line(s) look like a key or password}."
  fi

  count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  names=$(git diff --cached --name-only | head -3 | xargs -I{} basename "{}" | paste -sd, - | sed 's/,/, /g')
  subject="Update $names"
  [ "$count" -gt 3 ] && subject="$subject and $((count - 3)) more"

  if ! git commit -q -m "$subject" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; then
    git reset -q
    say "commit failed, nothing was pushed."
  fi
fi

git fetch -q origin 2>/dev/null
if git rev-parse -q --verify "origin/$branch" >/dev/null; then
  if [ "$(git rev-list --count "HEAD..origin/$branch")" != "0" ] \
    && ! git rebase -q "origin/$branch" >/dev/null 2>&1; then
    git rebase --abort
    say "saved on this Mac but not pushed, GitHub has changes that conflict with it."
  fi
  [ "$(git rev-list --count "origin/$branch..HEAD")" = "0" ] && exit 0
fi

if git push -q -u origin "$branch" 2>/dev/null; then
  say "pushed $(git log -1 --format='%h %s') to $branch."
fi
say "saved on this Mac but the push failed. It will retry after the next change."
