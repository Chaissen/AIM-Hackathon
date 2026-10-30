FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ehvd-mock/package.json services/ehvd-mock/
# A filtered `pnpm install` also installs the root project's dependencies. So the first command only checks that
# the lockfile is up to date, and deploy then installs the mock's production dependencies from it.
RUN pnpm install --frozen-lockfile --lockfile-only --filter ehvd-mock \
  && pnpm --config.inject-workspace-packages=true --filter ehvd-mock deploy --prod /tmp/deploy \
  && mv /tmp/deploy/node_modules services/ehvd-mock/node_modules \
  && rm -rf /tmp/deploy
COPY docs/ehvd/eHVD.wsdl docs/ehvd/
COPY services/ehvd-mock/src services/ehvd-mock/src
WORKDIR /app/services/ehvd-mock
USER node
EXPOSE 8095
CMD ["node", "src/main.ts"]
