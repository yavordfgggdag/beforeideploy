---
name: team-status
description: Show where the beforeideploy work stands — current branch, unsaved files, distance to main, what the partner is working on, last backup. Use when the user asks "какво става", status, "къде съм", "какво прави партньора", or after a break.
---

# Team status

Run `bash scripts/team/status.sh` and summarise in the user's language, in at most 6 lines:
the current branch and unsaved files; whether main has news to merge; the other person's active
branches (area prefix = who: mac/win = owner, linux/site = partner) with their last commit; the last backup.
If main is ahead, offer to merge it in. If there are unsaved files, offer to save.
