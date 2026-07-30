# CloudFront para mídia pública

Infraestrutura responsável por publicar `certifica-bucket/blog/media/*` em
`https://media.certifica.eng.br`, mantendo o S3 privado.

## Stacks

- `certifica-media-certificate`, em `us-east-1`: certificado ACM exigido pelo
  CloudFront;
- `certifica-media-cloudfront`, em `us-east-2`: OAC, distribuição e policy do
  bucket existente.

O DNS é administrado no Cloudflare. A validação do certificado e o CNAME público
devem ser criados nessa zona.

## Ordem

1. criar a stack do certificado;
2. publicar o CNAME de validação retornado pelo ACM;
3. aguardar a stack do certificado concluir;
4. criar a stack do CloudFront informando o ARN do certificado;
5. publicar `media.certifica.eng.br` como CNAME para o domínio da distribuição;
6. validar HTTP, cache e bloqueio do acesso direto ao S3.

Os comandos operacionais e critérios de aceite estão documentados em
`docs/cloudfront-media-roadmap.md`.
