# Cleanify Operations: production image for AWS (App Runner, ECS/Fargate,
# Lightsail containers or EC2). Listens on port 3000.
#
# NEXT_PUBLIC_* values are compiled into the browser code at BUILD time, so
# pass them as --build-arg. Server-only secrets (service role key, push private
# key, dispatch secret) are given at RUN time as environment variables and are
# never baked into the image. See docs/DEPLOY-AWS.md.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_STAFF_EMAIL_DOMAIN=cleanify.internal
ARG NEXT_PUBLIC_AUTH_MODE=password
ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
