---
name: restore
description: Restore the beforeideploy project from the local backup on this computer (~/BeforeIDeploy Backups) — a lost file, a bad change, or a broken clone. Use when the user says restore, възстанови, "изгубих", "върни версия", backup recovery.
---

# Restore from backup

Backups (made by `scripts/team/backup.sh` on every save and commit):
- `~/BeforeIDeploy Backups/beforeideploy.git` — mirror of every branch, current to the last save
- `~/BeforeIDeploy Backups/snapshots/beforeideploy-YYYY-MM-DD.bundle` — one full copy per day, last 7

Rules: never overwrite or delete the current project folder; always restore into a NEW folder, then copy
back only what the user picks.

1. List what exists: `ls -lt "$HOME/BeforeIDeploy Backups/snapshots"`.
2. Ask (or infer) what is lost: one file, one branch, or everything, and from when.
3. Whole project: `git clone "$HOME/BeforeIDeploy Backups/beforeideploy.git" ~/beforeideploy-restored`
   (or clone a dated `.bundle` for an older day).
4. One file: `git -C ~/beforeideploy-restored log --oneline -- <path>`, then
   `git -C ~/beforeideploy-restored show <commit>:<path> > <path>` inside the real project, after the user agrees.
5. Remember most history is also on GitHub: `git log --all -- <path>` in the project may be enough.
