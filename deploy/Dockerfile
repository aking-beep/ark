# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json factory.config.json ./
COPY packages ./packages
COPY apps ./apps
COPY docs/00-thesis.md ./docs/00-thesis.md
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh

RUN chmod +x deploy/entrypoint.sh \
  && npm ci \
  && npm run build:packages \
  && npm run build --workspace @ark/consumer \
  && npm run build --workspace @ark/business \
  && npm run build --workspace @ark/control

ENV NODE_ENV=production
ENV ARK_DATABASE_URL=file:/data/ark.db
EXPOSE 3000 3001 3002
VOLUME ["/data"]
CMD ["/app/deploy/entrypoint.sh"]
