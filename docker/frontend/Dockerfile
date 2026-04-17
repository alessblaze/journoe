FROM node:24-bookworm-slim AS build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/. .
ARG VITE_API_URL=/api
ARG VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ARG VITE_ALLOWED_HOSTS
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY} \
    VITE_ALLOWED_HOSTS=${VITE_ALLOWED_HOSTS}
RUN npm run build

FROM nginx:stable-alpine
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
