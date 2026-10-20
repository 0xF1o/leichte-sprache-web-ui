# Build-Stage
FROM node:22-alpine AS build
WORKDIR /app

# Optionale Voreinstellungen werden zur Build-Zeit eingebaut
ARG VITE_ANALYSE_URL=
ARG VITE_LLM_BASE_URL=
ARG VITE_LLM_MODEL=
ARG VITE_LLM_API_KEY=
ENV VITE_ANALYSE_URL=$VITE_ANALYSE_URL \
    VITE_LLM_BASE_URL=$VITE_LLM_BASE_URL \
    VITE_LLM_MODEL=$VITE_LLM_MODEL \
    VITE_LLM_API_KEY=$VITE_LLM_API_KEY

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Laufzeit-Stage: statischer Server
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
