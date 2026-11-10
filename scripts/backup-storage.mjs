import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const destination = path.resolve(process.argv[2] || "backup/storage");
const bucket = process.argv[3] || process.env.BACKUP_BUCKET || "oficina-evidence";
const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!baseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const headers = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
};

const manifest = {
  bucket,
  created_at: new Date().toISOString(),
  files: [],
};

function safeDestination(objectName) {
  const target = path.resolve(destination, bucket, objectName);
  const root = path.resolve(destination, bucket) + path.sep;
  if (!target.startsWith(root)) {
    throw new Error(`Caminho inválido no Storage: ${objectName}`);
  }
  return target;
}

function encodeObjectPath(objectName) {
  return objectName.split("/").map(encodeURIComponent).join("/");
}

async function list(prefix = "") {
  const out = [];
  let offset = 0;

  for (;;) {
    const response = await fetch(
      `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prefix,
          limit: 1000,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Falha ao listar Storage (${response.status}): ${await response.text()}`,
      );
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("Resposta inesperada ao listar Storage.");
    }

    out.push(...batch);
    if (batch.length < 1000) break;
    offset += batch.length;
  }

  return out;
}

async function walk(prefix = "") {
  const entries = await list(prefix);

  for (const entry of entries) {
    const objectName = prefix ? `${prefix}/${entry.name}` : entry.name;
    const looksLikeFolder = !entry.id && !entry.metadata;

    if (looksLikeFolder) {
      await walk(objectName);
      continue;
    }

    const response = await fetch(
      `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(objectName)}`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(
        `Falha ao baixar ${objectName} (${response.status}): ${await response.text()}`,
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const target = safeDestination(objectName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);

    manifest.files.push({
      name: objectName,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      content_type:
        entry?.metadata?.mimetype ||
        response.headers.get("content-type") ||
        "application/octet-stream",
      updated_at: entry.updated_at || null,
    });
  }
}

await fs.mkdir(path.join(destination, bucket), { recursive: true });
await walk("");

manifest.files.sort((a, b) => a.name.localeCompare(b.name));
manifest.file_count = manifest.files.length;
manifest.total_bytes = manifest.files.reduce((sum, file) => sum + file.size, 0);

await fs.writeFile(
  path.join(destination, "storage-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  `Storage backup concluído: ${manifest.file_count} arquivo(s), ${manifest.total_bytes} bytes.`,
);
