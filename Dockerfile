# ============================================================
# Stage 1: Build frontend (Preact + Vite)
# ============================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ============================================================
# Stage 2: Build Go binary
# ============================================================
FROM golang:1.23-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend-builder /build/frontend/dist/ ./internal/web/dist/

RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -trimpath \
    -o /traitors \
    ./cmd/traitors

# ============================================================
# Stage 3: Minimal runtime image
# ============================================================
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget

RUN addgroup -g 1000 -S traitors && \
    adduser -u 1000 -S traitors -G traitors

RUN mkdir -p /data && chown traitors:traitors /data

COPY --from=go-builder /traitors /usr/local/bin/traitors

USER traitors

ENV TRAITORS_PORT=8080
ENV TRAITORS_DB_PATH=/data/traitors.db
ENV TRAITORS_LOG_FORMAT=json

EXPOSE 8080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

ENTRYPOINT ["traitors"]
