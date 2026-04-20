# ==============================================================================
# Makefile — local CD for lobehub homelab deployment
#
# Workflow:
#   build image → push to GHCR → update Pulumi config → deploy to cluster
#
# Prerequisites:
#   - Docker (with buildx) installed and running
#   - Node.js installed (for reading package versions)
#   - Pulumi CLI installed  (https://www.pulumi.com/docs/install/)
#   - PULUMI_ACCESS_TOKEN exported in your shell
#   - KUBECONFIG pointing to the homelab cluster
#   - GITHUB_PAT exported (GitHub PAT with write:packages scope for push)
#
# Quickstart:
#   1. make build-push   — build image and push to GHCR
#   2. make deploy       — update Pulumi config with new tag and deploy
#
# Or all in one:
#   make release
# ==============================================================================

# === CUSTOMIZE THESE ===========================================================
STACK_NAME      ?= dev
GHCR_USER       ?= mrsimpson
# GITHUB_PAT must be set in your shell (write:packages scope)
# export GITHUB_PAT=ghp_...
# ===============================================================================

# Directory layout (all relative to this Makefile):
#   deployment/homelab/              ← this file lives here (PULUMI_DIR)
#   deployment/homelab/images/lobehub/  ← custom lobehub image
#   <repo-root>                       ← lobehub app source + upstream Dockerfile
PULUMI_DIR      := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
DEPLOY_DIR      := $(PULUMI_DIR)/..
MONOREPO_ROOT   := $(DEPLOY_DIR)/..

# Derived image name
LOBEHUB_IMAGE   := ghcr.io/$(GHCR_USER)/lobehub

# Version read from package.json at repo root
LOBEHUB_VERSION := $(shell node -p "require('$(MONOREPO_ROOT)/package.json').version" 2>/dev/null)

# Git short SHA for uniqueness — append .dirty when working tree has uncommitted changes
SHA_SHORT       := $(shell git -C $(MONOREPO_ROOT) rev-parse --short HEAD 2>/dev/null || echo "local")
GIT_DIRTY       := $(shell git -C $(MONOREPO_ROOT) status --porcelain 2>/dev/null | grep -q . && echo ".dirty" || echo "")

# Final image tag (matches CI pattern: <version>-local.<sha>[.dirty])
LOBEHUB_TAG     := $(LOBEHUB_VERSION)-local.$(SHA_SHORT)$(GIT_DIRTY)
LOBEHUB_FULL    := $(LOBEHUB_IMAGE):$(LOBEHUB_TAG)

# Upstream base tag (pinned in images/lobehub/.base-version)
BASE_VERSION    := $(shell cat $(PULUMI_DIR)/images/lobehub/.base-version 2>/dev/null | tr -d '[:space:]')

.PHONY: help build push build-push deploy release preview destroy logs

help:
	@echo ""
	@echo "lobehub homelab — local CD"
	@echo ""
	@echo "Image targets:"
	@echo "  build           Build custom lobehub image (linux/amd64)"
	@echo "  push            Push image to GHCR (requires GITHUB_PAT)"
	@echo "  build-push      Build + push"
	@echo ""
	@echo "Deployment targets:"
	@echo "  preview         Pulumi preview (dry-run)"
	@echo "  deploy          Update Pulumi config with current image tag + pulumi up"
	@echo "  release         build-push + deploy"
	@echo "  destroy         Destroy all cluster resources (asks for confirmation)"
	@echo "  logs            Show recent Pulumi stack history"
	@echo ""
	@echo "Active configuration:"
	@echo "  Stack      : $(STACK_NAME)"
	@echo "  GHCR user  : $(GHCR_USER)"
	@echo "  Base image : lobehub/lobehub:$(BASE_VERSION)"
	@echo "  Image      : $(LOBEHUB_FULL)"
	@echo ""

# ------------------------------------------------------------------------------
# Image build — always targets linux/amd64 (homelab cluster is x86_64)
# ------------------------------------------------------------------------------

build:
	@echo "→ Building $(LOBEHUB_FULL) (base: lobehub/lobehub:$(BASE_VERSION)) ..."
	docker buildx build \
		--platform linux/amd64 \
		--build-arg BASE_VERSION=$(BASE_VERSION) \
		--file $(PULUMI_DIR)/images/lobehub/Dockerfile \
		--tag $(LOBEHUB_FULL) \
		--tag $(LOBEHUB_IMAGE):latest \
		--load \
		$(PULUMI_DIR)/images/lobehub
	@echo "✓ Built $(LOBEHUB_FULL)"

# ------------------------------------------------------------------------------
# Push — requires GITHUB_PAT with write:packages scope
# ------------------------------------------------------------------------------

_ghcr-login:
	@if [ -z "$(GITHUB_PAT)" ]; then \
		echo "✗ GITHUB_PAT is not set. Export a GitHub PAT with write:packages scope:"; \
		echo "  export GITHUB_PAT=ghp_..."; \
		exit 1; \
	fi
	@echo "$(GITHUB_PAT)" | docker login ghcr.io -u $(GHCR_USER) --password-stdin

push: _ghcr-login
	@echo "→ Pushing $(LOBEHUB_FULL) ..."
	docker buildx build \
		--platform linux/amd64 \
		--build-arg BASE_VERSION=$(BASE_VERSION) \
		--file $(PULUMI_DIR)/images/lobehub/Dockerfile \
		--tag $(LOBEHUB_FULL) \
		--tag $(LOBEHUB_IMAGE):latest \
		--push \
		$(PULUMI_DIR)/images/lobehub
	@echo "✓ Pushed $(LOBEHUB_FULL)"

build-push: build push

# ------------------------------------------------------------------------------
# Pulumi deployment
# ------------------------------------------------------------------------------

preview:
	cd $(PULUMI_DIR) && pulumi preview --stack $(STACK_NAME) --diff

deploy:
	@echo "→ Updating Pulumi image config ..."
	cd $(PULUMI_DIR) && \
		pulumi config set --stack $(STACK_NAME) lobehub:lobehubImage "$(LOBEHUB_FULL)"
	@echo "→ Deploying stack $(STACK_NAME) ..."
	cd $(PULUMI_DIR) && pulumi up --stack $(STACK_NAME) --yes
	@echo "✓ Deployed"

release: build-push deploy

destroy:
	@echo "WARNING: This will PERMANENTLY destroy all resources in stack '$(STACK_NAME)'."
	@echo "         This cannot be undone."
	@printf "Type the stack name to confirm [$(STACK_NAME)]: " && read ans && [ "$$ans" = "$(STACK_NAME)" ] || (echo "Aborted." && exit 1)
	cd $(PULUMI_DIR) && pulumi destroy --stack $(STACK_NAME)

logs:
	cd $(PULUMI_DIR) && pulumi stack history --stack $(STACK_NAME) --page-size 10
