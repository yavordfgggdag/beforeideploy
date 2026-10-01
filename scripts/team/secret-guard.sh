#!/usr/bin/env bash
# Refuses a commit that would add a real key, token or password. Checks only the lines being added (staged),
# so old history and test fixtures do not get in the way. Exit 0 = clean, 1 = something found (printed).
# Override for a deliberate fake key: BID_ALLOW_SECRETS=1 git commit …
set -u
[ "${BID_ALLOW_SECRETS:-0}" = "1" ] && exit 0

found=0

# 1. files that should never be committed
bad_files=$(git diff --cached --name-only --diff-filter=AM | grep -E '(^|/)\.env($|\.)|\.(pem|p12|pfx|key|keystore|mobileprovision)$|(^|/)id_(rsa|ed25519)$' || true)
if [ -n "$bad_files" ]; then
  echo "✋ These files must not go into git (keys or local settings):"
  echo "$bad_files" | sed 's/^/   /'
  found=1
fi

# 2. secrets inside added lines (test fixtures are allowed to hold fake ones)
PATTERN='sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|pdl_(live|sdbx)_[A-Za-z0-9_]{10,}|nfp_[A-Za-z0-9]{30,}|sbp_[a-f0-9]{30,}|eyJhbGciOi[A-Za-z0-9_-]{80,}'
hits=$(git diff --cached -U0 --no-color -- . ':(exclude)tests/**' ':(exclude)**/*_test.*' ':(exclude)**/*.test.*' \
  | grep -E '^\+[^+]' | grep -oE "$PATTERN" | cut -c1-12 | sort -u || true)
if [ -n "$hits" ]; then
  echo "✋ Something that looks like a real key is about to be committed:"
  echo "$hits" | sed 's/$/…/; s/^/   /'
  echo "   Keep keys in the system keychain or in GitHub / Supabase settings, never in the code."
  found=1
fi

[ $found -eq 0 ] && exit 0
echo "   Nothing was committed. Remove the key and save again."
echo "   (Only for a deliberate fake key in an example: BID_ALLOW_SECRETS=1)"
exit 1
