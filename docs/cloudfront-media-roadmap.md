# Roadmap — entrega pública de mídia por CloudFront

Status: implementação e rollout em produção concluídos; validações manuais dos
clientes e Facebook Debugger pendentes  
Projetos envolvidos: `certifica-backend`, infraestrutura AWS e DNS  
Domínio proposto: `https://media.certifica.eng.br`

## Objetivo

Entregar os objetos de `certifica-bucket/blog/media/*` por URLs HTTPS públicas,
permanentes e cacheáveis, sem tornar o bucket S3 público.

O resultado esperado para uma mídia é:

```text
https://media.certifica.eng.br/blog/media/<uuid>.jpg
```

CloudFront será o único leitor público do prefixo no S3. A API continuará sendo
a única responsável por upload e exclusão.

## Arquitetura escolhida

```text
Dashboard ou MCP
       |
       | POST /blog/media/upload
       v
API Certifica ---- PutObject ----> S3 privado
       |                               ^
       | grava URL permanente          | Origin Access Control
       v                               |
PostgreSQL                     CloudFront público
                                       ^
                                       |
                         Site, Facebook e navegadores
```

Decisões:

- manter o S3 com Block Public Access ativado;
- usar CloudFront Origin Access Control (OAC), não OAI legado;
- permitir ao CloudFront somente `s3:GetObject` em `blog/media/*`;
- manter upload, alteração e exclusão passando exclusivamente pela API;
- usar chaves imutáveis e `Cache-Control: public, max-age=31536000, immutable`;
- não usar URLs assinadas para imagens públicas do blog;
- manter a rota `/blog/media/:id/file` temporariamente para compatibilidade.

## Fase 0 — inventário e preparação

- [x] Confirmar conta AWS, região e nome do bucket de produção.
- [x] Confirmar que os objetos editoriais ficam somente em `blog/media/*`.
- [x] Levantar quantidade e volume total de registros `Media` com `source = S3`.
- [x] Localizar URLs antigas dentro de `Post.content`, capas e outros campos.
- [x] Confirmar onde o DNS de `certifica.eng.br` é administrado.
- [x] Definir janela de deploy e responsável pelo rollback.
- [x] Fazer backup lógico das tabelas de mídia e posts antes da migração.

Entregável: inventário registrado sem alteração de produção.

## Fase 1 — infraestrutura AWS

### Certificado

- [x] Solicitar no ACM de `us-east-1` um certificado para
      `media.certifica.eng.br`.
- [x] Criar o registro DNS de validação.
- [x] Aguardar o certificado ficar com status `Issued`.

### CloudFront

- [x] Criar uma distribuição com o bucket S3 como origem.
- [x] Criar e associar um Origin Access Control.
- [x] Configurar assinatura de requisições ao S3 como `always`.
- [x] Permitir somente `GET`, `HEAD` e `OPTIONS` para visitantes.
- [x] Redirecionar HTTP para HTTPS.
- [x] Ativar compressão automática.
- [x] Usar uma cache policy otimizada para conteúdo estático.
- [x] Associar o certificado e o domínio `media.certifica.eng.br`.
- [x] Não configurar encaminhamento de cookies ou query strings.

### Policy do bucket

- [x] Manter todas as opções de Block Public Access ativadas.
- [x] Adicionar permissão `s3:GetObject` para o principal
      `cloudfront.amazonaws.com`.
- [x] Restringir o recurso a
      `arn:aws:s3:::certifica-bucket/blog/media/*`.
- [x] Restringir `AWS:SourceArn` à distribuição criada.
- [x] Confirmar que uma URL direta do S3 continua respondendo `403`.
- [x] Confirmar que a URL padrão da distribuição responde `200`.

Entregável: CloudFront acessa o prefixo e o S3 continua privado.

## Fase 2 — domínio e DNS

- [x] Criar `media.certifica.eng.br` apontando para a distribuição CloudFront.
- [x] Se o DNS estiver no Cloudflare, iniciar com o registro em modo DNS only.
- [x] Aguardar a distribuição e o DNS propagarem.
- [x] Validar certificado, cadeia TLS e redirecionamento HTTPS.
- [x] Validar resposta pública pela distribuição CloudFront.

Entregável: uma imagem existente abre por
`https://media.certifica.eng.br/blog/media/<storageKey>`.

## Fase 3 — alterações na API

### Configuração

- [x] Adicionar `MEDIA_PUBLIC_BASE_URL` ao schema de ambiente.
- [x] Configurar produção com `https://media.certifica.eng.br`.
- [x] Documentar a variável em `.env.example`, sem incluir credenciais.

Exemplo:

```env
MEDIA_PUBLIC_BASE_URL=https://media.certifica.eng.br
```

### Geração de URL

- [x] Criar um helper que monte a URL pública a partir de `storageKey`.
- [x] Remover barras duplicadas e rejeitar chaves fora de `blog/media/`.
- [x] Fazer novos uploads salvarem a URL CloudFront no registro `Media`.
- [x] Preservar `storageKey` como fonte de verdade do objeto.
- [x] Manter `/blog/media/:id/file` funcionando durante a transição.
- [x] Garantir que mídia criada por URL externa continue sem alteração.

### Contratos e segurança

- [x] Confirmar que dashboard, MCP e blog não dependem do formato antigo da URL.
- [x] Confirmar que nenhuma credencial AWS será entregue aos clientes.
- [x] Garantir que o MCP continue enviando arquivos somente para a API.
- [x] Registrar em auditoria a `storageKey`, URL final, MIME e tamanho otimizado.
- [x] Validar montagem, prefixo permitido e URL final durante build e smoke test.

Entregável: novos uploads já nascem com URL permanente do CloudFront.

## Fase 4 — migração das mídias existentes

- [x] Criar o comando `npm run media:migrate-cloudfront-urls`.
- [x] Implementar modo `--dry-run` como padrão.
- [x] Exigir uma opção explícita, como `--apply`, para gravar alterações.
- [x] Processar somente registros `Media` com `source = S3` e `storageKey`.
- [x] Atualizar `Media.url` usando `MEDIA_PUBLIC_BASE_URL` e `storageKey`.
- [x] Substituir no HTML dos posts as URLs antigas conhecidas pela nova URL.
- [x] Não modificar imagens externas.
- [x] Processar sequencialmente e produzir contagens de alterados e inválidos.
- [x] Tornar o comando idempotente para permitir repetição segura.
- [x] Registrar mídia sem `storageKey` como pendência, sem inferência destrutiva.

Ordem de execução:

1. [x] rodar `--dry-run` em produção;
2. [x] revisar contagens e amostras;
3. [x] fazer backup;
4. [x] fazer deploy da API;
5. [x] rodar `--apply`;
6. [x] repetir `--dry-run` e esperar zero alterações pendentes.

Entregável: capas e imagens do corpo usam o domínio permanente.

## Fase 5 — validação ponta a ponta

### HTTP e cache

- [x] Confirmar `200` sem redirecionamento na URL CloudFront.
- [x] Confirmar `Content-Type: image/jpeg` nas imagens otimizadas.
- [x] Confirmar arquivo abaixo de 950 KB.
- [x] Confirmar `Cache-Control` de longa duração.
- [x] Confirmar `Age` e `X-Cache` após a segunda requisição.
- [x] Confirmar que a URL não contém `X-Amz-*` nem data de expiração.
- [x] Confirmar que a URL direta do S3 permanece bloqueada.

### Aplicações

- [ ] Fazer upload pela dashboard e selecionar como capa.
- [ ] Fazer upload pelo MCP e publicar um post de teste.
- [x] Validar imagem, post público e conteúdo HTML no post afetado.
- [ ] Validar criação e edição com imagem externa, sem regressão.
- [ ] Validar exclusão de post sem remover indevidamente mídia compartilhada.

### Robôs sociais

- [x] Conferir `og:image` no HTML renderizado.
- [x] Testar com user-agent `facebookexternalhit`.
- [ ] Solicitar nova coleta no Facebook Sharing Debugger.
- [ ] Validar a prévia no Facebook e em outro consumidor Open Graph.

Entregável: publicação completa aprovada em dashboard, MCP, blog e Facebook.

## Fase 6 — rollout e observabilidade

- [x] Fazer deploy primeiro com a rota antiga ainda ativa.
- [x] Verificar logs iniciais da API e respostas do CloudFront sem erros.
- [ ] Monitorar taxa de acerto do cache, bytes transferidos e custos.
- [x] Verificar logs da API após o rollout.
- [ ] Manter logs de acesso ou métricas pelo período inicial de estabilização.
- [ ] Após estabilização, decidir se a rota de redirecionamento será depreciada.
- [x] Atualizar a documentação da API e do procedimento operacional.

Entregável: entrega estabilizada e procedimento operacional documentado.

## Critérios de aceite

- Todo novo upload editorial armazenado no S3 possui no máximo 950 KB.
- `og:image` aponta diretamente para `media.certifica.eng.br`.
- A URL da imagem responde `200`, sem redirecionamento e sem assinatura.
- O Facebook consegue coletar e exibir a imagem.
- O objeto não pode ser acessado diretamente pelo domínio do S3.
- Somente o prefixo `blog/media/*` é legível pelo CloudFront.
- Dashboard e MCP continuam fazendo upload exclusivamente pela API.
- Imagens externas continuam aceitas.
- A migração pode ser repetida sem produzir alterações adicionais.

## Rollback

Se a entrega pelo CloudFront falhar:

1. manter os objetos intactos no S3;
2. reverter `MEDIA_PUBLIC_BASE_URL` e o deploy da API;
3. restaurar as URLs do banco pelo backup ou script reverso;
4. manter `/blog/media/:id/file` como rota de compatibilidade;
5. não remover a distribuição nem a policy antes de concluir o diagnóstico;
6. invalidar somente URLs afetadas se algum objeto mutável tiver sido cacheado.

Como as chaves são imutáveis, o rollback não exige mover ou reenviar arquivos.

## Itens fora deste roadmap

- upload direto do navegador ou do MCP para o S3;
- bucket inteiramente público;
- URLs assinadas para mídia editorial pública;
- transformação dinâmica de imagem no CloudFront;
- remoção automática de objetos órfãos;
- variantes responsivas em WebP ou AVIF.
