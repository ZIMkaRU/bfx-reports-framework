#!/bin/bash

set -euo pipefail

set -a
[ -f .env ] && . .env
set +a

SCRIPTPATH="$(cd -- "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
ROOT="$(dirname "$SCRIPTPATH")"
CURRDIR="$PWD"

COLOR_RED="\033[31m"
COLOR_GREEN="\033[32m"
COLOR_BLUE="\033[34m"
COLOR_NORMAL="\033[39m"

programname=$0
uiSubmoduleName=bfx-report-ui
expressSubmoduleName=bfx-report-express
branch="${REPO_BRANCH:-"master"}"

syncAll=0
syncWorker=0
syncUI=0
syncExpress=0

function usage {
  echo -e "\
\n${COLOR_GREEN}Usage: $programname [options] | [-h]${COLOR_BLUE}
\nOptions:
  -a    Sync all repositories
  -w    Sync bfx-reports-framework only
  -u    Sync bfx-report-ui only
  -e    Sync bfx-report-express only
  -h    Display help\
${COLOR_NORMAL}" 1>&2
}

if [ $# == 0 ]; then
  usage
  exit 1
fi

while getopts "awueh" opt; do
  case "${opt}" in
    a) syncAll=1;;
    w) syncWorker=1;;
    u) syncUI=1;;
    e) syncExpress=1;;
    h)
      usage
      exit 0
      ;;
    *)
      echo -e "\n${COLOR_RED}No reasonable options found!${COLOR_NORMAL}"
      usage
      exit 1
      ;;
  esac
done

cd "$ROOT"

if [ $syncWorker == 1 ] && [ $syncUI == 1 ] && [ $syncExpress == 1 ]; then
  syncAll=1
  syncWorker=0
  syncUI=0
  syncExpress=0
fi

if [ $syncAll == 1 ] || [ $syncWorker == 1 ] || [ $syncUI == 1 ] || [ $syncExpress == 1 ]; then
  git config url."https://github.com/".insteadOf git@github.com:
  git fetch --recurse-submodules=on-demand
  git submodule sync --recursive
  git config --unset url."https://github.com/".insteadOf
fi

if [ $syncAll == 1 ]; then
  git clean -fd
  git reset --hard "origin/$branch"

  git submodule foreach --recursive "git clean -fd; git reset --hard HEAD"
  git submodule update --init --force --recursive

  cd "$CURRDIR"
  exit 0
fi
if [ $syncWorker == 1 ]; then
  git clean -fd
  git reset --hard "origin/$branch"
fi
if [ $syncUI == 1 ]; then
  git submodule foreach '
    if [ "$sm_path" = "$uiSubmoduleName" ]; then
      git clean -fd
      git reset --hard HEAD
    fi
'

  git submodule update --init --force $uiSubmoduleName
fi
if [ $syncExpress == 1 ]; then
  git submodule foreach --recursive '
    if [ "$sm_path" = "$expressSubmoduleName" ]; then
      git clean -fd
      git reset --hard HEAD
    fi
'
  git submodule foreach '
    if [ "$sm_path" = "$uiSubmoduleName" ]; then
      git submodule update --init --force $expressSubmoduleName
    fi
'
fi

cd "$CURRDIR"
