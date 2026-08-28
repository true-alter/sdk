FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json tsup.config.ts ./
RUN npm install

COPY src ./src
COPY bin ./bin
RUN npm run build

ENV ALTER_MCP_ENDPOINT=https://mcp.truealter.com/api/v1/mcp

CMD ["node", "dist/bin/mcp-bridge.js"]
