#!/bin/bash
set -o pipefail

eslint "{src,tests}/**/*.{js,jsx,ts,tsx}" --fix --concurrency=auto --prune-suppressions
eslint "{src,tests}/**/*.{js,jsx,ts,tsx}" --concurrency=auto