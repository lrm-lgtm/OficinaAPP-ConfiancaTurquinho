#!/usr/bin/env bash
set -euo pipefail

root="${1:-backup}"

required=(
  "$root/db/roles.sql"
  "$root/db/schema.sql"
  "$root/db/data.sql"
  "$root/storage/storage-manifest.json"
  "$root/created_at_utc.txt"
  "$root/project_ref.txt"
)

for file in "${required[@]}"; do
  if [ ! -s "$file" ]; then
    echo "Arquivo obrigatório ausente ou vazio: $file" >&2
    exit 1
  fi
done

if ! grep -qi "work_orders" "$root/db/schema.sql"; then
  echo "schema.sql não contém a tabela work_orders." >&2
  exit 1
fi

if ! grep -qi "work_orders" "$root/db/data.sql"; then
  echo "data.sql não contém referência a work_orders." >&2
  exit 1
fi

node - "$root/storage/storage-manifest.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
if (!manifest.bucket || !Array.isArray(manifest.files)) {
  throw new Error("Manifesto de Storage inválido.");
}
for (const item of manifest.files) {
  if (!item.name || !Number.isFinite(item.size) || !/^[a-f0-9]{64}$/.test(item.sha256 || "")) {
    throw new Error("Entrada inválida no manifesto de Storage.");
  }
}
console.log(`Manifesto de Storage válido: ${manifest.files.length} arquivo(s).`);
NODE

(
  cd "$root"
  find . -type f ! -name "checksums.sha256" -print0 \
    | sort -z \
    | xargs -0 sha256sum > checksums.sha256
)

sha256sum -c "$root/checksums.sha256"

echo "Backup validado com sucesso."
