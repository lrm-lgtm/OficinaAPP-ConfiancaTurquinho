import fs from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] || "backup/storage");
const manifestPath = path.join(source, "storage-manifest.json");
const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!baseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do projeto de destino são obrigatórios.");
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const bucket = manifest.bucket;

function encodeObjectPath(objectName) {
  return objectName.split("/").map(encodeURIComponent).join("/");
}

for (const file of manifest.files || []) {
  const localPath = path.resolve(source, bucket, file.name);
  const expectedRoot = path.resolve(source, bucket) + path.sep;
  if (!localPath.startsWith(expectedRoot)) {
    throw new Error(`Caminho inválido no manifesto: ${file.name}`);
  }

  const bytes = await fs.readFile(localPath);
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(file.name)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": file.content_type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    throw new Error(
      `Falha ao restaurar ${file.name} (${response.status}): ${await response.text()}`,
    );
  }
}

console.log(`Storage restaurado: ${manifest.files?.length || 0} arquivo(s).`);
