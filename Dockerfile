# Deployer — container deploy admin, single image.
FROM node:20-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
COPY docs ./docs
COPY templates-bundled ./templates-bundled
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh \
  && chmod +x /entrypoint.sh \
  && mkdir -p /var/lib/deployer \
  && chown -R node:node /app /var/lib/deployer
EXPOSE 3000
ENV NODE_ENV=production
ENV DEPLOYER_SOFTWARE=bash,curl
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
