# 壁毯织补定位网校核 —— 一体化镜像（Web 服务 + 一次性验收共用）
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 项目无外部依赖，直接拷贝源码（tests 一并带入，供 verify 服务使用）
COPY package.json ./
COPY server.js verify.js ./
COPY public/ ./public/
COPY test/ ./test/

# 容器内服务端口（宿主机端口由 docker-compose 的 HOST_PORT 配置）
ENV PORT=8080
EXPOSE 8080

# 健康检查：Web 服务提供 GET /health
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
