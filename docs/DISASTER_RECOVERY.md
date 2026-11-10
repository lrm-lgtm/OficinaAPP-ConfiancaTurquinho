# Disaster Recovery — Oficina Confiança

Este procedimento existe para o cenário de perda do projeto Supabase, exclusão acidental relevante ou necessidade de restauração em outro projeto.

## 1. Baixar e validar o artifact

Baixe o artifact desejado do workflow **Backup automático da Oficina**.

Confira o checksum do pacote:

```bash
sha256sum -c oficina-backup-*.tar.gz.enc.sha256
```

## 2. Descriptografar

Use a mesma frase armazenada em `OFICINA_BACKUP_PASSPHRASE`:

```bash
export BACKUP_PASSPHRASE='...'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -md sha256 \
  -pass env:BACKUP_PASSPHRASE \
  -in oficina-backup-YYYYMMDDTHHMMSSZ.tar.gz.enc \
  -out oficina-backup.tar.gz
mkdir restore
tar -C restore -xzf oficina-backup.tar.gz
cd restore
sha256sum -c checksums.sha256
```

## 3. Restaurar banco

Crie ou escolha o projeto Supabase de destino e obtenha sua connection string.

A restauração lógica segue a ordem documentada pelo Supabase:

```bash
psql --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file db/roles.sql \
  --file db/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file db/data.sql \
  --dbname "$TARGET_DB_URL"
```

Se o destino já tiver objetos Supabase pré-criados, podem aparecer mensagens de objetos já existentes. Faça a restauração primeiro em ambiente de teste quando houver dúvida.

## 4. Restaurar arquivos físicos do Storage

O dump do banco preserva metadados, mas não contém os bytes das fotos. Depois que o bucket existir no destino:

```bash
export SUPABASE_URL='https://NOVO-PROJETO.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
node scripts/restore-storage.mjs restore/storage
```

O script usa o manifesto do backup para repor os objetos e seus content-types.

## 5. Reimplantar componentes fora do dump

Os seguintes componentes não devem ser tratados como recuperados apenas pelo dump do banco:

- Edge Functions;
- secrets das Edge Functions;
- configurações de Auth;
- API keys/JWT secrets;
- Realtime/publications quando recriadas fora das migrations;
- configurações de domínio.

O código-fonte e as migrations ficam versionados neste repositório. Reaplique as migrations necessárias e redeploy das Edge Functions a partir do Git.

## 6. Testes mínimos após restauração

Antes de liberar uso:

1. login de um usuário interno;
2. abrir lista de OS;
3. abrir uma OS com fotos;
4. conferir orçamento e aprovação;
5. conferir estoque;
6. conferir financeiro;
7. testar uma alteração em celular e notebook;
8. confirmar Realtime;
9. gerar uma nova foto de vistoria e validar upload/hash.

## Regra de ouro

Nunca apague o projeto original antes de validar o destino restaurado.
