#!/usr/bin/env bash
set -euo pipefail

# Remove stale node_modules (e.g. from a Windows checkout) and install Linux-native deps.
rm -rf node_modules
npm ci
