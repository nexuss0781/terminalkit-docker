FROM node:22-alpine

RUN apk add --no-cache util-linux
WORKDIR /app

COPY agent.mjs /app/agent.mjs

ENV PORT=8080
EXPOSE 8080

CMD ["node", "/app/agent.mjs"]
