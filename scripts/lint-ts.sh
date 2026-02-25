#!/bin/bash
set -o pipefail

eslint "src/**/*.{js,jsx,ts,tsx}" "tests/**/*.{js,jsx,ts,tsx}" --fix --concurrency=auto --prune-suppressions
eslint "src/**/*.{js,jsx,ts,tsx}" "tests/**/*.{js,jsx,ts,tsx}" --concurrency=auto
