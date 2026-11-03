FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM rust:slim-bookworm AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
COPY src-rust ./src-rust
RUN cargo build --release --bin discord-fabrica

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /app/dist ./dist
COPY --from=backend /app/target/release/discord-fabrica /app/discord-fabrica
EXPOSE 3000
CMD ["/app/discord-fabrica"]
