# hellostash with the patches this deployment needs (see patch.js).
#
# Every patch asserts its anchor before replacing anything, so bumping
# HELLOSTASH_VERSION past a release whose dist no longer matches fails the build
# instead of producing an image that is only half patched.
FROM node:22-alpine

ARG HELLOSTASH_VERSION=0.1.0
ENV NODE_ENV=production

RUN npm install -g --omit=dev --no-audit --no-fund --no-cache hellostash@${HELLOSTASH_VERSION} \
 && npm cache clean --force \
 && rm -rf /root/.npm /usr/local/lib/node_modules/npm/.cache

COPY patch.js /tmp/patch.js
RUN node /tmp/patch.js && rm /tmp/patch.js

# Delivery health report, run as `docker exec <container> hs-check`.
COPY hs-check.js /usr/local/bin/hs-check
RUN chmod 0755 /usr/local/bin/hs-check

USER node
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node","-e","fetch('http://127.0.0.1:8080/v2/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node","/usr/local/lib/node_modules/hellostash/dist/bin.js"]
