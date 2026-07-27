# Integração editorial por MCP

O `certifica-mcp` é um processo local que se comunica com a API Certifica. Ele
não acessa PostgreSQL ou S3 diretamente e não abre servidor HTTP.

O caminho de mídia é sempre:

```text
Claude/Codex -> MCP local -> API Certifica -> S3
```

O MCP envia o arquivo em multipart para a rota da API. A API valida, processa,
faz o upload no bucket e persiste o registro `Media`. As configurações e
credenciais AWS existem somente no ambiente da API.

## Preparação da API

1. Aplique a migration `20260727210000_add_mcp_integration_support`.
2. Configure as variáveis AWS já usadas pelo upload de mídia.
3. Crie um cliente com o script `api-client:create`.
4. Entregue o token uma única vez ao responsável pelo cliente local.

Administradores e editores também podem gerenciar os próprios tokens pelo
dashboard em `/integrations`. A API expõe:

- `GET /integrations/api-clients`;
- `POST /integrations/api-clients`;
- `DELETE /integrations/api-clients/:id` para revogação.

Essas rotas aceitam somente JWT de usuário; um token de integração não pode
criar ou revogar outros tokens. O segredo aparece apenas na resposta de criação.

Exemplo:

```bash
npm run api-client:create -- "Codex editorial" usuario posts:read,posts:write,media:read,media:write
```

Para agendar ou publicar, inclua `posts:publish`. Use esse scope somente em
clientes autorizados.

## Scopes

- `posts:read`: consultar posts;
- `posts:write`: validar, criar e editar drafts;
- `posts:publish`: agendar ou publicar;
- `media:read`: listar mídias;
- `media:write`: fazer upload.

O dashboard continua usando JWT. Tokens de integração são armazenados apenas
como hash, podem expirar ou ser revogados e atualizam `lastUsedAt`.

## Conteúdo editorial

O campo `content` usa o contrato:

```json
{
  "format": "html",
  "version": 1,
  "html": "<p>Conteúdo sanitizado</p>"
}
```

A API sanitiza o HTML, valida placeholders, URLs locais, texto alternativo,
metadados SEO e capa. Edições aceitam `expectedVersion` para impedir sobrescrita
concorrente.

## Segurança operacional

- mutações e uploads aceitam `Idempotency-Key`;
- ações automatizadas geram `AuditLog`;
- criar post pelo MCP força `DRAFT`;
- publicar e agendar exigem scope próprio e confirmação no MCP;
- credenciais AWS permanecem apenas na API;
- segredos não devem ser versionados nem enviados em argumentos de ferramentas.

Antes de produção, faça smoke test do upload real, confirme a URL pública/CDN,
revogue credenciais antigas e teste expiração/revogação dos tokens.
