FROM node:24-bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bash ca-certificates curl supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
