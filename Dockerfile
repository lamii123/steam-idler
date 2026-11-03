FROM node:22-slim

RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && adduser --system --group app

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ src/
COPY public/ public/

RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
