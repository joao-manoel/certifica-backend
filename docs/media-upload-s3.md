# Upload de imagens para S3 — API

Status: implementação local concluída; infraestrutura e smoke test pendentes  
Projetos envolvidos: `certifica-backend` e `certifica-dashboard`

Roadmap da entrega pública permanente:
[`cloudfront-media-roadmap.md`](./cloudfront-media-roadmap.md).

## Objetivo

Permitir que um editor cadastre mídia de duas formas:

1. informando uma URL externa, como já ocorre em `POST /blog/media`;
2. enviando um arquivo de imagem, que será armazenado no S3.

Os dois fluxos devem criar e retornar o mesmo recurso `Media`. A listagem e o uso
da imagem como capa continuam funcionando sem o cliente precisar saber como ela
foi hospedada.

## Estado atual

- `POST /blog/media` recebe JSON com URL e metadados.
- `GET /blog/media` lista as mídias cadastradas.
- `src/lib/s3.ts` já contém `uploadToS3`, `deleteFromS3`,
  `getSignedGetUrl` e `streamToBuffer`.
- O Fastify já registra `@fastify/multipart`.
- O modelo `Media` armazena URL, alt, MIME, dimensões e cor dominante.
- Apenas `ADMIN` e `EDITOR` podem criar e listar mídia.

O helper S3 existente reduz o trabalho, mas ainda não há uma rota que receba o
arquivo nem uma referência à chave do objeto no banco.

## Decisões de arquitetura

### Manter endpoints separados

- `POST /blog/media`: mantém o contrato JSON para URL externa.
- `POST /blog/media/upload`: novo contrato `multipart/form-data` para arquivo.

Separar os contratos evita um body ambíguo, preserva compatibilidade e permite
limites e documentação específicos para upload.

### Retornar o mesmo recurso

Os dois endpoints retornam HTTP `201` com:

```json
{
  "id": "uuid",
  "url": "https://cdn.exemplo.com/blog/media/uuid.webp",
  "alt": "Descrição da imagem",
  "mimeType": "image/webp",
  "width": 1600,
  "height": 900,
  "dominantClr": "#2f4a3c",
  "createdAt": "2026-07-27T12:00:00.000Z",
  "updatedAt": "2026-07-27T12:00:00.000Z"
}
```

Assim, `GET /blog/media`, `coverId` e os consumidores atuais não mudam.

### URL pública permanente pelo CloudFront

Novos uploads armazenam diretamente em `Media.url` a URL pública e imutável:

`{MEDIA_PUBLIC_BASE_URL}/{storageKey}`

Em produção, o resultado segue o formato:

`https://media.certifica.eng.br/blog/media/{uuid}.jpg`

O CloudFront usa OAC para ler o objeto no bucket privado. A rota legada
`{API_URL}/blog/media/{mediaId}/file` permanece disponível e redireciona para a
URL pública do CDN, sem gerar uma URL S3 assinada.

Com isso:

- o bucket continua privado;
- posts nunca armazenam uma URL assinada ou temporária;
- credenciais AWS permanecem somente na API;
- o Facebook recebe a imagem diretamente, sem expiração ou redirecionamento;
- CloudFront pode manter o objeto em cache usando a chave imutável.

O comando `npm run media:migrate-cloudfront-urls` opera em dry-run por padrão.
Depois da revisão, `npm run media:migrate-cloudfront-urls -- --apply` atualiza
registros `Media` e URLs inseridas no HTML dos posts.

### Registrar a origem e a chave

Adicionar ao modelo `Media`:

```prisma
enum MediaSource {
  EXTERNAL
  S3
}

model Media {
  // campos atuais
  source     MediaSource @default(EXTERNAL)
  storageKey String?     @unique
}
```

- Registros existentes ficam como `EXTERNAL`, sem migração manual de dados.
- Uploads recebem `source: S3` e a chave retornada por `uploadToS3`.
- URLs externas recebem `source: EXTERNAL` e `storageKey: null`.
- `storageKey` permite exclusão, auditoria e troca futura de domínio/CDN.

`source` e `storageKey` podem ficar fora da resposta pública inicial. Eles não são
necessários para selecionar uma capa e a chave interna não deve ser confiada ao
cliente.

## Contrato do novo endpoint

### `POST /blog/media/upload`

Autorização:

- JWT obrigatório;
- header `x-api-key` conforme middleware atual;
- papel `ADMIN` ou `EDITOR`.

Content-Type: `multipart/form-data`

Campos:

| Campo  | Tipo    | Obrigatório | Regra                          |
| ------ | ------- | ----------- | ------------------------------ |
| `file` | arquivo | sim         | uma imagem permitida           |
| `alt`  | texto   | não         | trim, máximo de 200 caracteres |

Resposta:

- `201`: objeto `Media`, no mesmo formato de `POST /blog/media`;
- `400`: multipart inválido, arquivo ausente ou imagem inválida;
- `401/403`: autenticação ou papel insuficiente, conforme padrão atual;
- `413`: arquivo acima do limite;
- `415`: tipo não suportado;
- `500/502`: falha de armazenamento sem registro órfão no banco.

## Validação e processamento

Para a primeira versão:

- aceitar JPEG, PNG e WebP;
- opcionalmente aceitar GIF somente se animação for um requisito;
- não aceitar SVG inicialmente, pois exige política própria de sanitização;
- limite por imagem: 25 MiB, alinhado ao limite multipart global;
- validar MIME declarado e conteúdo real, não apenas extensão;
- rejeitar arquivo vazio, múltiplos arquivos e dimensões inválidas;
- gerar o nome no servidor; nunca usar o nome original como chave;
- usar pasta `blog/media`;
- converter toda imagem aceita para JPEG progressivo;
- limitar o arquivo armazenado a 950 KB, deixando margem abaixo de 1 MB;
- começar com dimensão máxima de 2400 px e qualidade 84;
- reduzir qualidade e, quando necessário, dimensões até atingir o limite;
- aplicar fundo branco em imagens com transparência durante a conversão;
- calcular largura, altura e cor dominante no backend;
- normalizar orientação EXIF antes de salvar metadados.

O processamento usa o `sharp` já instalado no backend. A otimização acontece
antes de `uploadToS3`, portanto o bucket nunca recebe a versão original pesada.
Os metadados persistidos (`mimeType`, largura, altura e cor dominante) representam
o arquivo otimizado que foi efetivamente armazenado.

## Fluxo transacional e compensação

S3 e PostgreSQL não compartilham transação. A rota deve compensar falhas:

1. autenticar e validar campos;
2. ler o arquivo com limite;
3. validar/processar a imagem;
4. enviar o objeto ao S3;
5. construir a URL estável da rota pública da API;
6. criar `Media` no Prisma com `source` e `storageKey`;
7. retornar `201`.

Se o passo 6 falhar depois do upload, executar `deleteFromS3(storageKey)`. Registrar
a falha de compensação para limpeza posterior, sem incluir credenciais ou conteúdo
do arquivo no log.

Não criar o registro antes do upload: isso produziria uma mídia selecionável cuja
URL ainda não existe.

## Estrutura sugerida

- `prisma/schema.prisma`: `MediaSource` e novos campos.
- `prisma/migrations/<timestamp>_add_media_storage_fields/migration.sql`.
- `src/http/routes/blog/media/upload-media.ts`: endpoint multipart.
- `src/http/routes/index.ts`: registro de `uploadMedia`.
- `src/lib/s3.ts`: montagem segura da URL e, se necessário, opções de cache.
- `src/utils/midia-utils.ts`: tipos permitidos e validações compartilhadas.

Também é recomendável extrair o schema/serialização de `Media` para evitar
duplicação entre criação por URL, upload e listagem.

## Segurança e operação

- Nunca receber bucket, key ou ACL do cliente.
- Aplicar princípio do menor privilégio à credencial AWS:
  `s3:PutObject`, `s3:GetObject` apenas se necessário e `s3:DeleteObject` no
  prefixo `blog/media/*`.
- Bloquear ACL pública na chamada de upload; publicação deve ocorrer via CDN.
- Definir `Cache-Control` longo para objetos com chave imutável, por exemplo
  `public, max-age=31536000, immutable`.
- Não sobrescrever uma chave existente.
- Não registrar buffer, token, API key ou credenciais.
- Considerar rate limit por usuário e varredura de malware em uma fase posterior.
- Configurar CORS no CDN/bucket apenas para origens que realmente precisem.

## Exclusão e ciclo de vida

Excluir mídia não faz parte da primeira entrega. Quando for implementado:

- impedir exclusão enquanto houver `Post.coverId` referenciando a mídia, ou exigir
  confirmação e remover a referência;
- chamar `deleteFromS3` apenas quando `source === S3` e houver `storageKey`;
- nunca tentar apagar uma URL externa;
- usar compensação caso S3 e banco divirjam;
- criar regra de lifecycle para limpar uploads órfãos, se houver fluxo temporário.

## Testes e critérios de aceite da API

- URL externa continua criando mídia sem regressão.
- JPEG, PNG e WebP válidos criam um objeto no S3 e um registro no banco.
- A URL retornada abre a imagem por meio da origem/CDN configurada.
- MIME falso, arquivo vazio, SVG e arquivo acima do limite são rejeitados.
- `USER` e requisição anônima não fazem upload.
- Falha do Prisma após upload remove o objeto do S3.
- A nova mídia aparece em `GET /blog/media` e pode ser usada como `coverId`.
- Lint e build passam.

Para testes automatizados, mockar o cliente S3 e Prisma na unidade/integração.
Manter ao menos um teste de integração opcional contra bucket de desenvolvimento,
nunca contra produção.

## Roadmap

### Fase 0 — infraestrutura e decisões

- [x] Manter o bucket privado e entregar imagens por redirecionamento assinado.
- [x] Definir URL permanente da API para capas e imagens do corpo.
- [x] Limite definido em 25 MiB; formatos iniciais JPEG, PNG e WebP.
- [ ] Validar permissões IAM e CORS.

### Fase 1 — modelo e contrato

- [x] Adicionar `MediaSource` e `storageKey`.
- [x] Criar e revisar migration Prisma.
- [x] Extrair schema/serializer comum de `Media`.
- [x] Documentar `POST /blog/media/upload`.

### Fase 2 — upload na API

- [x] Adicionar processamento de imagem com `sharp`.
- [x] Implementar validação multipart e assinatura real do arquivo.
- [x] Enviar para `blog/media` com chave imutável.
- [x] Persistir metadados e implementar compensação.
- [x] Registrar a rota e mapear erros `413`/`415`.
- [x] Manter rota legada que redireciona para a URL pública do CDN.
- [x] Criar migração operacional para URLs S3 já cadastradas.

### Fase 3 — integração com dashboard

- [x] Implementar cliente multipart direto para a API.
- [x] Adicionar aba “Upload” ao seletor de capa.
- [x] Exibir preview, estado indeterminado e erros.
- [x] Invalidar galeria e selecionar a mídia criada.

### Fase 4 — qualidade e entrega

- [ ] Cobrir validações e compensação com testes.
- [x] Comprimir automaticamente todo novo upload para no máximo 950 KB.
- [x] Normalizar JPEG, PNG e WebP para JPEG progressivo antes do S3.
- [x] Executar build nos dois projetos e lint nos arquivos alterados do dashboard.
- [ ] Fazer smoke test no bucket de desenvolvimento.
- [ ] Validar criação e edição de post com URL, upload e galeria.
- [ ] Observar erros, latência e volume após deploy.

### Fase 5 — evoluções

- [ ] Exclusão segura de mídia S3.
- [ ] Paginação/busca completa na galeria.
- [x] Redimensionamento adaptativo para garantir o limite do arquivo original.
- [ ] Variantes responsivas.
- [ ] Conversão opcional para WebP/AVIF quando houver suporte de entrega.
- [ ] Rate limit, malware scan e limpeza de órfãos.
- [ ] Upload direto com URL pré-assinada se tamanho/escala justificar.

## Fora do escopo inicial

- upload direto do navegador para S3;
- edição/crop de imagem;
- múltiplos arquivos por requisição;
- substituição de arquivo existente;
- exclusão de mídia;
- migração automática das URLs externas existentes para o S3.

Upload pré-assinado é uma evolução válida para arquivos grandes ou alto volume,
mas adiciona etapas de iniciação/finalização e tratamento de órfãos. Para o volume
editorial atual e os helpers já existentes, upload via API é o caminho de menor
complexidade.
