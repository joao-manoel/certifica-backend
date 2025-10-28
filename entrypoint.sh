#!/bin/sh

# Aplica as migrações no banco
npx prisma migrate deploy

npx concurrently \
  "node dist/http/server.js" \
  "node dist/queue/queue.js"