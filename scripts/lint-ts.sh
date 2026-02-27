#!/bin/bash
set -o pipefail

eslint src/ tests/ --fix --concurrency=auto --prune-suppressions
eslint src/ tests/ --concurrency=auto
