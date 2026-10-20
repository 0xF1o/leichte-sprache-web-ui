# Build-Stage
FROM node:22-alpine AS build
WORKDIR /app

# Optionale Voreinstellungen werden zur Build-Zeit eingebaut.
# WICHTIG: Alles, was hier eingebaut wird, landet im öffentlichen, statischen
# JS-Bundle und ist für alle Besucher sichtbar – deshalb bewusst OHNE
# LSWUI_API_KEY. Den API-Schlüssel gibt jeder Benutzer zur Laufzeit selbst in
# der Einstellungen-Sektion ein (wird nur im Browser gespeichert).
ARG LSWUI_ANALYSE_URL=
ARG LSWUI_BASE_URL=
ARG LSWUI_MODEL=
ENV LSWUI_ANALYSE_URL=$LSWUI_ANALYSE_URL \
    LSWUI_BASE_URL=$LSWUI_BASE_URL \
    LSWUI_MODEL=$LSWUI_MODEL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Laufzeit-Stage: statischer Server ohne Root-Berechtigung, lauscht auf 8080
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
