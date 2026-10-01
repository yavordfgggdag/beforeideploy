#!/bin/zsh
# Double-click: saves everything (commit → GitHub → backup in ~/BeforeIDeploy Backups).
cd "${0:A:h}"
bash scripts/team/setup.sh --quiet
bash scripts/team/save.sh
echo
read -k1 "?Натисни клавиш за затваряне…"
