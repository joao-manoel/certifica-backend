FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Builda o projeto
RUN npm run build

# Copia script de inicialização
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]