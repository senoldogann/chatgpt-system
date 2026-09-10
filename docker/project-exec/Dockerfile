FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ cmake \
  && npm install --global pnpm@10.15.1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
