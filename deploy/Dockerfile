# syntax=docker/dockerfile:1
# Python 3.12 is required by my-ai/pyproject.toml (requires-python >= 3.12).
# Node 22 is copied from the official tarball so one image can run MY AI API + three Next apps.
FROM python:3.12-slim-bookworm
WORKDIR /app

ARG NODE_VERSION=22.14.0
# Set by BuildKit per target platform (amd64, arm64). Node's tarballs name the
# same architectures x64 and arm64, so map rather than hard-code x64 — a
# hard-coded x64 binary fails with "exec format error" on Graviton / Apple Silicon.
ARG TARGETARCH
# --max-time so a hung nodejs.org does not stall `docker compose up --build`.
RUN set -eu; \
  case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
    amd64|x86_64) NODE_ARCH=x64 ;; \
    arm64|aarch64) NODE_ARCH=arm64 ;; \
    *) echo "unsupported architecture: ${TARGETARCH:-unknown}" >&2; exit 1 ;; \
  esac; \
  apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && curl -fsSLo /tmp/node.tar.xz --max-time 120 --retry 3 \
       "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && apt-get purge -y xz-utils \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && node -v && npm -v && python3 --version

COPY package.json package-lock.json tsconfig.base.json factory.config.json ./
COPY packages ./packages
COPY apps ./apps
COPY my-ai ./my-ai
COPY docs/00-thesis.md ./docs/00-thesis.md
COPY deploy/entrypoint.sh deploy/healthcheck.sh ./deploy/

RUN pip3 install --no-cache-dir -e ./my-ai

ENV API_ORIGIN=http://127.0.0.1:8472
ENV MYAI_ROOT=/app/my-ai

RUN chmod +x deploy/entrypoint.sh deploy/healthcheck.sh \
  && npm ci \
  && npm run build:packages \
  && npm run build --workspace @ark/consumer \
  && npm run build --workspace @ark/business \
  && npm run build --workspace @ark/control

# Run as an unprivileged user. It owns /app (Next writes .next/cache at runtime,
# my-ai's filesystem store writes under MYAI_ROOT) and /data (the SQLite volume).
# A named volume mounted on /data inherits this ownership on first creation.
RUN groupadd --system --gid 10001 ark \
  && useradd --system --uid 10001 --gid ark --home-dir /app --shell /usr/sbin/nologin ark \
  && mkdir -p /data \
  && chown -R ark:ark /app /data
USER ark

ENV NODE_ENV=production
ENV ARK_DATABASE_URL=file:/data/ark.db
EXPOSE 3000 3001 3002 8472
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=20s --start-period=90s --retries=3 \
  CMD ["/app/deploy/healthcheck.sh"]
CMD ["/app/deploy/entrypoint.sh"]
