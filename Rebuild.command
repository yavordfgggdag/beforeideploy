#!/bin/zsh
# Quick rebuild (skips engine tests)
cd "${0:A:h}"
zsh ./scripts/install.sh --skip-tests
