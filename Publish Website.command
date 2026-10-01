#!/bin/zsh
# Double-click: publishes site/ to the Netlify project "beforeideploy" (https://beforeideploy.netlify.app).
# The first time Netlify opens the browser to sign in; after that it is one click.
cd "${0:A:h}"
SITE_ID="268f97af-c087-4903-991f-fd262b3cbb17"
command -v node >/dev/null || { echo "Нужен е Node.js: brew install node"; read -k1; exit 1; }
git pull -q 2>/dev/null
python3 scripts/site-build.py
npx -y netlify-cli status >/dev/null 2>&1 || npx -y netlify-cli login
npx -y netlify-cli deploy --prod --dir site --site "$SITE_ID" --message "Website $(git rev-parse --short HEAD)"
echo
echo "✅ Готово: https://beforeideploy.netlify.app"
open "https://beforeideploy.netlify.app"
read -k1 "?Натисни клавиш за затваряне…"
