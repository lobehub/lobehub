# BASE_VERSION is read from .base-version by CI.
# Locally defaults to "latest" — override with: docker build --build-arg BASE_VERSION=2.1.50
ARG BASE_VERSION=latest
FROM lobehub/lobehub:${BASE_VERSION}

# The upstream lobehub runtime image is `FROM scratch` with only /bin/node and
# a handful of shared libraries copied in. That means:
#   - No shell, no package manager, no RUN commands are possible.
#   - We can only COPY files and set ENV variables here.
#
# Bake in deployment-wide defaults below. These are still overridable by
# Kubernetes env vars set in the Pulumi stack.

# Place any custom public assets, branding, or config overrides under
# config/ and COPY them into the image. The directory exists so that
# `docker build` succeeds even when it is empty.
COPY config/ /app/config-overrides/

# Sensible homelab defaults — override at runtime via the Pulumi stack env.
ENV \
    # Force IPv4 DNS resolution first (see upstream issue #5876)
    MIDDLEWARE_REWRITE_THROUGH_LOCAL="1" \
    # Default feature flags — customise as needed
    FEATURE_FLAGS=""
