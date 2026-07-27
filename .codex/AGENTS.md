# Certifica Backend — orientações para agentes

## Visão do projeto

API do ecossistema Certifica. É um serviço Node.js em TypeScript com Fastify 5,
Prisma/PostgreSQL, autenticação JWT, Redis/Bull para jobs, S3 para mídia,
Nodemailer e instrumentação OpenTelemetry.

Entradas principais:

- `src/http/server.ts`: configura e inicia o Fastify.
- `src/http/routes/index.ts`: registra todas as rotas.
- `src/queue/queue.ts`: inicia o processamento da fila.
- `prisma/schema.prisma`: fonte de verdade do modelo de dados.
- `src/env.ts`: validação e acesso às variáveis de ambiente.

## Organização e padrões

- Coloque endpoints em `src/http/routes/<dominio>` e registre cada novo módulo em
  `src/http/routes/index.ts`.
- Valide payload, params e respostas com Zod e o type provider do Fastify.
- Use os middlewares de `src/http/middlewares` para autenticação JWT e API key;
  não replique validação de credenciais dentro das rotas.
- Reutilize os singletons de `src/lib` para Prisma, Redis, fila, S3 e e-mail.
- Lance os erros HTTP definidos em `src/http/_errors` e deixe
  `src/http/error-handle.ts` produzir a resposta.
- Mantenha tarefas assíncronas em `src/queue/jobs` e registre-as no índice de jobs.
- Use o alias `@/*` para imports a partir de `src`.
- Preserve TypeScript estrito, nomes e mensagens de domínio em português quando
  esse for o padrão do módulo, aspas duplas e ausência de ponto e vírgula.
- O ESLint exige imports agrupados, separados por linha em branco e ordenados.

## Banco de dados

- Toda alteração de schema deve incluir uma migration Prisma; não edite migrations
  já aplicadas.
- Revise relações, índices e comportamento de exclusão antes de migrar.
- Atualize `prisma/seed.ts` quando a mudança afetar os dados iniciais.
- Não execute migration destrutiva ou contra banco remoto sem autorização
  explícita.

## Ambiente e segurança

- Nunca registre, copie ou versione valores de `.env`.
- A aplicação depende de PostgreSQL e, para filas/métricas, Redis. Integrações
  adicionais usam S3, SMTP e OTLP.
- Trate `JWT_SECRET`, `API_KEY`, credenciais do banco, S3 e SMTP como segredos.
- Não enfraqueça autenticação, autorização por papel (`ADMIN`, `EDITOR`, `USER`),
  limites de upload ou sanitização sem uma justificativa explícita.

## Comandos e validação

- Desenvolvimento completo: `npm run dev`
- API sem o worker, quando necessário: `npx tsx watch --require tsconfig-paths/register src/http/server.ts`
- Worker: `npm run dev:queue`
- Lint: `npm run lint`
- Build/typecheck: `npm run build`
- Formatação: `npm run format`
- Prisma local: `npx prisma generate`, `npx prisma migrate dev`

Não há suíte de testes configurada: `npm test` falha intencionalmente. Para uma
mudança de código, rode ao menos lint e build; para rotas ou migrations, descreva
também a verificação manual realizada.

## Acordos de trabalho

- Antes de adicionar dependências, verifique se a capacidade já existe no projeto
  e explique o custo da nova dependência.
- Preserve contratos consumidos por `certifica-blog` e `certifica-dashboard`.
- Mudanças de resposta, autenticação, cookies, mídia ou paginação devem considerar
  os dois clientes.
- Faça alterações pequenas e focadas; não reformate arquivos sem relação com a
  tarefa.
