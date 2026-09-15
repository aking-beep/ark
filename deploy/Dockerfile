# syntax=docker/dockerfile:1
# Python 3.12 is required by fit/pyproject.toml (requires-python >= 3.12).
# Node 22 is copied from the official tarball so one image can run Fit API + three Next apps.
FROM python:3.12-slim-bookworm
WORKDIR /app

ARG NODE_VERSION=22.14.0
# --max-time so a hung nodejs.org does not stall `docker compose up --build`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && curl -fsSLo /tmp/node.tar.xz --max-time 120 --retry 3 \
       "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && apt-get purge -y xz-utils \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && node -v && npm -v && python3 --version

COPY package.json package-lock.json tsconfig.base.json factory.config.json ./
COPY packages ./packages
COPY apps ./apps
COPY fit ./fit
COPY docs/00-thesis.md ./docs/00-thesis.md
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh

RUN pip3 install --no-cache-dir -e ./fit

ARG NEXT_PUBLIC_ARK_BUSINESS_URL=http://localhost:3001
ENV NEXT_PUBLIC_ARK_BUSINESS_URL=$NEXT_PUBLIC_ARK_BUSINESS_URL
ENV API_ORIGIN=http://127.0.0.1:8472
ENV AIFIT_ROOT=/app/fit

RUN chmod +x deploy/entrypoint.sh \
  && npm ci \
  && npm run build:packages \
  && npm run build --workspace @ark/consumer \
  && npm run build --workspace @ark/business \
  && npm run build --workspace @ark/control

ENV NODE_ENV=production
ENV ARK_DATABASE_URL=file:/data/ark.db
EXPOSE 3000 3001 3002 8472
VOLUME ["/data"]
CMD ["/app/deploy/entrypoint.sh"]
