# Build-Stage
FROM node:22-alpine AS build
WORKDIR /app

# Optionale Voreinstellungen werden zur Build-Zeit eingebaut
ARG LSWUI_ANALYSE_URL=
ARG LSWUI_BASE_URL=
ARG LSWUI_MODEL=
ARG LSWUI_API_KEY=
ENV LSWUI_ANALYSE_URL=$LSWUI_ANALYSE_URL \
    LSWUI_BASE_URL=$LSWUI_BASE_URL \
    LSWUI_MODEL=$LSWUI_MODEL \
    LSWUI_API_KEY=$LSWUI_API_KEY

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Laufzeit-Stage: statischer Server
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
