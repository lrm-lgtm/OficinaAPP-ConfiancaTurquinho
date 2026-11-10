# Backup automático — Oficina Confiança

## Objetivo

Proteger o banco PostgreSQL e os arquivos de evidência da oficina fora do Supabase, sem colocar credenciais ou dados em claro no repositório.

O workflow é executado diariamente às **03:30 BRT** e também pode ser disparado manualmente.

## O que entra no backup

- roles do PostgreSQL compatíveis com exportação Supabase;
- schema, funções, triggers, RLS e demais objetos exportados pelo `supabase db dump`;
- dados do banco;
- objetos físicos do bucket `oficina-evidence`;
- manifesto do Storage com tamanho, MIME e SHA-256 de cada arquivo;
- checksums SHA-256 de todos os arquivos internos.

O pacote final é criptografado com **AES-256-CBC + PBKDF2** antes de ser enviado ao GitHub Actions Artifact.

## Secrets obrigatórios

O workflow usa três GitHub Actions Secrets e nunca grava os valores no Git:

- `OFICINA_SUPABASE_DB_URL`: URL de conexão PostgreSQL, preferencialmente a Session Pooler.
- `OFICINA_SUPABASE_SERVICE_ROLE_KEY`: chave service-role usada somente pelo job para copiar o Storage.
- `OFICINA_BACKUP_PASSPHRASE`: frase aleatória com pelo menos 24 caracteres, exclusiva para criptografar os backups.

Sem os três secrets o job falha antes de acessar os dados.

## Retenção V1

O GitHub Actions limita a retenção de artifacts. A política inicial é:

- diário: 14 dias;
- semanal (domingo): 35 dias;
- mensal (dia 1): 90 dias.

A segunda cópia com retenção longa em Drive/S3 deve ser adicionada como V2; ela não substitui a cópia criptografada já mantida fora do Supabase.

## Validação automática

Antes de publicar o artifact, o job exige:

- `roles.sql`, `schema.sql` e `data.sql` não vazios;
- presença da estrutura e dados de `work_orders`;
- manifesto do Storage válido;
- SHA-256 válido para cada arquivo copiado;
- conferência de todos os checksums internos.

Se qualquer teste falhar, nenhum backup em claro é publicado.

## Segurança

O repositório é público. Por isso:

- nenhum dump em claro é commitado;
- nenhuma chave é armazenada em arquivo;
- apenas o `.tar.gz.enc` e seu checksum são enviados como artifact;
- o diretório em claro é removido antes do upload.

A senha de criptografia deve ser guardada também fora do GitHub. Sem ela, o backup criptografado não pode ser recuperado.

## Arquivos

- `.github/workflows/backup.yml`
- `scripts/backup-storage.mjs`
- `scripts/restore-storage.mjs`
- `scripts/validate-backup.sh`
- `docs/DISASTER_RECOVERY.md`
