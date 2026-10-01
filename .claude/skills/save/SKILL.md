---
name: save
description: Save all work in the beforeideploy repo — commit everything, push to GitHub, refresh the backup on this computer. Use when the user says save, запази, commit, качи, backup, бакъп, or before switching tasks.
---

# Save

Run the team save script from the repository root:

```sh
bash scripts/team/save.sh "<short message>"
```

- Write the message yourself from what changed, in English, imperative, ≤ 60 characters
  (e.g. `Pricing: add yearly toggle`). Without a message the script writes one from the changed areas.
- The script never commits on `main` (it moves the work to a new `wip/…` branch) and refuses keys and
  secrets (`scripts/team/secret-guard.sh`). If it refuses, tell the user which file and why; never bypass
  it with `BID_ALLOW_SECRETS=1` unless the user confirms the value is a deliberate fake.
- The backup goes to `~/BeforeIDeploy Backups/` on the user's own computer (skipped in cloud sessions).

Report in one or two lines, in the user's language: what was saved, the branch, pushed or not, backup made or not.
