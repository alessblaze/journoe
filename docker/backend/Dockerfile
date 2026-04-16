FROM golang:1.26.2-alpine AS build
WORKDIR /app/backend

ARG TARGETARCH

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/. .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -o /journal-server .

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -u 10001 appuser
COPY --from=build /journal-server /usr/local/bin/journal-server
USER appuser
EXPOSE 8080
CMD ["journal-server"]
