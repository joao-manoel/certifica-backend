# Roadmap — biblioteca e gerenciamento de mídia

Status: implementação local concluída; migration e rollout pendentes  
Projetos: `certifica-backend` e `certifica-dashboard`

## Objetivo

Criar uma biblioteca administrativa em `/media` para:

- pesquisar, filtrar e visualizar imagens;
- cadastrar imagem externa ou fazer upload pela API;
- editar metadados;
- recortar, girar, espelhar ou substituir uma imagem hospedada;
- conhecer os posts que utilizam cada mídia;
- excluir com segurança registros e objetos S3 sem quebrar publicações.

Dashboard e MCP continuam enviando arquivos exclusivamente para a API. Nenhuma
credencial AWS será entregue ao cliente.

## Estado atual

Já disponível:

- `POST /blog/media` para cadastrar uma URL externa;
- `POST /blog/media/upload` para validar, otimizar e enviar ao S3;
- `GET /blog/media` com paginação, busca e ordenação;
- imagens S3 privadas entregues por `media.certifica.eng.br`;
- metadados básicos: `alt`, MIME, dimensões e cor dominante;
- escopos `media:read` e `media:write`;
- seletor de capa no dashboard com galeria, URL e upload.

Ainda não disponível:

- detalhe individual, edição e exclusão de mídia;
- edição do arquivo;
- contagem e listagem de usos;
- proteção contra exclusão de uma imagem utilizada;
- página própria de gerenciamento no dashboard.

## Princípios

1. O bucket permanece privado e todo upload passa pela API.
2. Objetos do CloudFront são imutáveis; nunca sobrescrever uma chave existente.
3. Editar o arquivo cria uma nova versão, mantém o mesmo `Media.id` e atualiza as
   referências conhecidas.
4. Toda URL de uma versão já publicada continua respondendo `200`; trocar a
   imagem nunca remove nem sobrescreve imediatamente o objeto anterior.
5. Exclusão é recusada com `409 Conflict` enquanto houver uso em capa ou corpo.
6. Imagem externa pode ter URL e metadados editados, mas não pode ser recortada
   pela API; isso evita download arbitrário e SSRF.
7. Toda mutação relevante gera auditoria.
8. A biblioteca usa os mesmos contratos no dashboard, no editor e no MCP.

## Modelo de dados proposto

Adicionar ao modelo `Media`:

```prisma
title            String? @db.VarChar(160)
caption          String? @db.VarChar(500)
credit           String? @db.VarChar(300)
originalFilename String? @db.VarChar(255)
fileSizeBytes    Int?
createdById      String?
createdBy        User?   @relation(...)
```

Manter `url`, `source`, `storageKey`, `alt`, `mimeType`, `width`, `height` e
`dominantClr`.

Adicionar histórico de arquivos hospedados:

```prisma
model MediaVersion {
  id            String   @id @default(uuid())
  mediaId       String
  media         Media    @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  url           String   @unique
  storageKey    String   @unique
  mimeType      String
  width         Int
  height        Int
  fileSizeBytes Int
  dominantClr   String?
  isCurrent     Boolean  @default(false)
  createdAt     DateTime @default(now())

  @@index([mediaId, createdAt])
  @@index([mediaId, isCurrent])
}
```

Para mídia S3, `Media.url` e `Media.storageKey` apontam para a versão atual.
`MediaVersion` preserva todas as URLs que já foram publicadas. A migration inicial
cria uma versão para cada mídia S3 existente.

Índices:

- `Media(createdAt)`;
- `Media(updatedAt)`;
- `Media(source, createdAt)`;
- índice de `createdById`.

Não criar tabela de uso na primeira entrega. Capas são consultadas pela relação
`Post.coverId`; imagens no corpo são localizadas pelas URLs conhecidas no JSON de
`Post.content`. Caso o volume torne essa busca cara, evoluir depois para
`MediaUsage`.

## Contratos da API

### Listagem

Evoluir `GET /blog/media`:

- filtros `source`, `used`, `createdById`, `createdFrom` e `createdTo`;
- busca em título, alt, legenda, crédito, nome original e URL;
- retornar `source`, `storageKey`, `fileSizeBytes`, metadados editoriais;
- retornar resumo `usageCount`, `coverUsageCount` e `bodyUsageCount`;
- manter paginação e campos atuais para não quebrar o seletor de capa.

### Detalhe

Criar `GET /blog/media/:id` com:

- todos os metadados;
- resumo de armazenamento;
- lista paginada de posts que usam a mídia;
- capacidades calculadas: `canEditImage`, `canDelete` e motivo do bloqueio.

### Edição de metadados

Criar `PATCH /blog/media/:id`:

```json
{
  "title": "Fachada principal",
  "alt": "Fachada acessível do edifício",
  "caption": "Vista após a reforma",
  "credit": "Acervo Certifica",
  "url": "https://exemplo.com/imagem.jpg"
}
```

Regras:

- campos opcionais e anuláveis com limites explícitos;
- `url` editável somente quando `source = EXTERNAL`;
- recalcular MIME inferido quando a URL externa mudar;
- não aceitar alteração direta de `source`, `storageKey`, dimensões ou tamanho;
- registrar antes/depois no `AuditLog`.

### Edição do arquivo

Criar `POST /blog/media/:id/transform` multipart:

- arquivo opcional para substituição;
- `rotate`: `0 | 90 | 180 | 270`;
- `flipHorizontal` e `flipVertical`;
- recorte por `left`, `top`, `width`, `height`;
- `alt`, título, legenda e crédito opcionais na mesma operação;
- header `Idempotency-Key`.

Fluxo:

1. confirmar `source = S3`;
2. validar limites e dimensões do recorte;
3. baixar o objeto atual ou usar o arquivo substituto;
4. aplicar transformação com Sharp;
5. passar novamente pelo otimizador de até 950 KB;
6. calcular MIME, dimensões, tamanho e cor dominante;
7. enviar para uma nova chave `blog/media/<uuid>.jpg`;
8. criar `MediaVersion`, marcar a versão anterior como histórica, atualizar
   `Media` e URLs em `Post.content` na mesma transação;
9. invalidar somente as queries da biblioteca;
10. remover a nova chave se o banco falhar;
11. manter a chave anterior no S3 e no CloudFront para que HTML em cache, posts
    antigos, compartilhamentos e consumidores externos continuem funcionando.

Não invalidar CloudFront: a nova chave evita conteúdo antigo em cache.

### Garantia de referências

Ao editar uma imagem:

- capas ligadas por `coverId` passam a usar automaticamente a versão atual;
- URLs conhecidas no `Post.content` são trocadas pela nova URL em transação;
- a URL anterior permanece pública e imutável;
- se a atualização de qualquer referência falhar, a versão atual não é trocada;
- uma reconciliação em dry-run identifica conteúdo interno que ainda usa versões
  históricas, sem tornar a imagem indisponível.

Essa combinação garante que a imagem não quebre durante ou depois da edição. Um
conteúdo antigo pode temporariamente mostrar a versão anterior, mas nunca recebe
`404` por causa da troca.

### Exclusão

Criar `DELETE /blog/media/:id`:

- exigir `media:write` e papel `ADMIN` ou `EDITOR`;
- calcular usos antes de excluir;
- retornar `409` com os posts dependentes quando estiver em uso;
- excluir registro externo somente do banco;
- para S3, excluir o registro somente após confirmar que não há usos internos;
- remover todas as versões apenas numa exclusão explícita confirmada; a interface
  deve avisar que URLs compartilhadas externamente deixarão de funcionar;
- se a remoção S3 falhar, registrar auditoria e enfileirar nova tentativa;
- responder `204` quando concluído;
- suportar `Idempotency-Key`.

Não implementar `force=true` na primeira versão. O usuário deverá trocar ou
remover os usos explicitamente antes da exclusão.

### Auditoria e erros

Eventos:

- `media.create`;
- `media.upload`;
- `media.update`;
- `media.transform`;
- `media.delete`;
- `media.storage_delete_failed`.

Erros esperados:

- `400`: transformação ou campos inválidos;
- `401/403`: autenticação ou escopo;
- `404`: mídia inexistente;
- `409`: mídia em uso ou conflito de edição;
- `413`: arquivo acima do limite de entrada;
- `415`: formato não suportado.

## Dashboard

### Navegação e página

- adicionar “Mídia” ao menu principal, apontando para `/media`;
- permitir acesso a `ADMIN` e `EDITOR`;
- criar título, resumo de quantidade/uso e botão “Adicionar mídia”;
- usar URL como fonte de verdade para busca, filtros, página e ordenação.

### Galeria

- grade responsiva com alternativa de tabela;
- thumbnail, título/alt, origem, dimensões, tamanho, data e indicador de uso;
- seleção individual e ações por item;
- skeleton, vazio, erro, retry e paginação;
- busca com debounce;
- filtros por origem, MIME, uso e período;
- ordenação por criação e atualização.

### Adicionar mídia

Reutilizar e extrair o fluxo do `CoverPickerDialog`:

- aba Upload com arrastar/selecionar, preview e validação;
- aba URL externa;
- metadados editoriais;
- progresso e prevenção de envio duplicado;
- ao concluir, inserir o item na galeria e invalidar `['media']`.

O seletor de capa passa a reutilizar o mesmo formulário/serviço, evitando dois
fluxos divergentes.

### Detalhe e edição

Abrir drawer ou página `/media/:id`:

- preview em tamanho maior;
- URL com ação de copiar;
- origem, MIME, dimensões, tamanho e datas;
- formulário de título, alt, legenda e crédito;
- lista de posts que utilizam a imagem, com links;
- salvar com feedback e proteção contra alterações não salvas.

### Editor da imagem

Para mídia S3:

- preview com recorte;
- proporções livre, 1:1, 4:3, 16:9 e 1200:630;
- girar e espelhar;
- substituir arquivo;
- mostrar dimensões previstas;
- confirmar que a operação gera uma nova URL;
- enviar coordenadas e transformações à API, não processar o arquivo final apenas
  no navegador.

Para mídia externa, mostrar “Substituir por upload” ou edição da URL; não oferecer
recorte remoto.

### Exclusão

- diálogo com thumbnail e nome;
- carregar usos antes de confirmar;
- bloquear ação e listar posts quando `canDelete = false`;
- permitir exclusão apenas quando não houver uso;
- após `204`, remover do cache React Query e da galeria;
- mensagens distintas para registro externo e objeto hospedado.

## Fases de implementação

### Fase 0 — contratos e banco

- [x] Fechar campos editoriais e limites.
- [x] Criar migrations de `Media` e `MediaVersion` e atualizar serialização.
- [x] Criar versões iniciais para as mídias S3 já existentes.
- [x] Definir consulta de usos no corpo e em capas.
- [x] Documentar contratos e exemplos.

### Fase 1 — leitura e metadados na API

- [x] Evoluir listagem sem quebrar clientes.
- [x] Implementar detalhe e usos.
- [x] Implementar `PATCH`.
- [x] Adicionar auditoria e verificações de papel/escopo.

### Fase 2 — transformação e exclusão na API

- [x] Implementar transformação para nova chave.
- [x] Versionar o arquivo e atualizar URLs dos posts de forma transacional.
- [x] Preservar URLs históricas.
- [x] Reconciliar referências antigas durante cada transformação.
- [x] Implementar exclusão protegida.
- [x] Registrar falhas de limpeza S3 para reconciliação operacional.
- [x] Implementar compensação de upload quando a transação falhar.

### Fase 3 — fundação da biblioteca no dashboard

- [x] Adicionar rota e navegação.
- [x] Criar clientes HTTP e tipos.
- [x] Criar busca, filtro por origem, grade e paginação.
- [x] Criar formulário administrativo de upload/URL.

### Fase 4 — edição no dashboard

- [x] Criar detalhe e formulário de metadados.
- [x] Criar controles de recorte, rotação e espelhamento.
- [x] Criar substituição de arquivo.
- [x] Criar exclusão com análise de uso e confirmação.

### Fase 5 — integração e estabilização

- [x] Preservar o seletor de capa sobre os mesmos contratos de mídia.
- [ ] Validar dashboard desktop e mobile.
- [ ] Validar upload e seleção no editor de posts.
- [ ] Validar MCP sem regressão.
- [x] Validar builds e contratos locais da API e dashboard.
- [ ] Validar que exclusão nunca quebra posts publicados.
- [ ] Fazer rollout com backup, métricas e logs.

## Testes mínimos

API:

- papéis e escopos em todos os endpoints;
- validação de metadados e transformação;
- mídia externa não pode usar transformação remota;
- nova chave e arquivo menor que 950 KB;
- atualização de capa e conteúdo;
- rollback transacional e disponibilidade das versões anteriores;
- compensação quando S3 ou banco falhar;
- `409` ao excluir mídia utilizada;
- exclusão externa e S3 sem uso;
- idempotência.

Dashboard:

- estados loading, vazio, erro e sucesso;
- busca, filtros, ordenação e paginação;
- upload, URL externa e validação de arquivo;
- formulário com erros de API;
- recorte acessível por mouse e teclado quando possível;
- bloqueio de exclusão com links dos usos;
- responsividade.

## Critérios de aceite

- ADMIN e EDITOR gerenciam mídia em `/media`.
- Upload continua passando somente pela API.
- Imagens hospedadas permanecem privadas no S3 e públicas pelo CloudFront.
- Transformação gera nova URL e arquivo JPEG de até 950 KB.
- A URL anterior continua respondendo `200` depois da transformação.
- Capas e referências internas passam para a versão nova sem janela de quebra.
- Metadados podem ser editados sem trocar a imagem.
- O sistema mostra onde uma mídia é usada.
- Uma mídia utilizada não pode ser excluída.
- Exclusão sem uso remove o registro e, quando S3, o objeto.
- Seletor de capa e MCP continuam funcionando.
- Toda mutação fica auditada.

## Fora da primeira versão

- edição destrutiva da mesma chave S3;
- transformação dinâmica por parâmetros na URL do CloudFront;
- vídeo, áudio, SVG ou documentos;
- pastas, coleções e tags;
- exclusão em massa;
- remoção automática de versões históricas;
- geração automática de variantes responsivas;
- importação server-side de URLs externas.
