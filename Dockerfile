ARG APP_FOLDER=/app
ARG APP_GID=1000
ARG APP_UID=1000
ARG APP_USER=node
ARG ENABLE_LOGS=false

#######################################################
# Builder
#######################################################

FROM node:24-alpine as builder

ARG APP_FOLDER
ARG APP_GID
ARG APP_UID
ARG APP_USER

RUN apk --no-cache add shadow \
  && groupmod -g $APP_GID node \
  && usermod -u $APP_UID -g $APP_GID $APP_USER

WORKDIR $APP_FOLDER
COPY . .

RUN npm ci
RUN npm run build

RUN chown -R $APP_USER $APP_FOLDER

USER $APP_USER

#######################################################
# App container
#######################################################

FROM node:24-slim as runtime
RUN rm /bin/sh && ln -s /bin/bash /bin/sh

ARG APP_FOLDER
ARG APP_USER

ENV NODE_ENV=production

WORKDIR $APP_FOLDER

COPY --from=builder \
  $APP_FOLDER/dist/ \
  .

COPY --from=builder \
  $APP_FOLDER/node_modules/ \
  node_modules

COPY --from=builder \
  $APP_FOLDER/package.json \
  package.json

COPY --from=builder \
  $APP_FOLDER/tsconfig.json \
  tsconfig.json

USER $APP_USER

CMD node -r tsconfig-paths/register index.js
