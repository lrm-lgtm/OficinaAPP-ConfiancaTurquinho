import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeDataUrl(dataUrl: string) {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("invalid_signature");
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return { bytes, mime: match[1].toLowerCase() === "jpeg" ? "image/jpeg" : "image/png", ext: match[1].toLowerCase() === "jpeg" ? "jpg" : "png" };
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });

  try {
    const body = await req.json();
    const token = String(body.token || "");
    const name = String(body.name || "").trim();
    const decision = body.decision === "revision_requested" ? "revision_requested" : "approved";
    const consent = body.consent === true;

    if (!token || !name) return Response.json({ error: "missing_fields" }, { status: 400, headers: cors });
    if (decision === "approved" && !consent) return Response.json({ error: "consent_required" }, { status: 400, headers: cors });
    if (decision === "approved" && !body.signatureDataUrl) return Response.json({ error: "signature_required" }, { status: 400, headers: cors });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow, error: tokenError } = await supabase
      .from("approval_tokens")
      .select("id, token, expires_at, revoked_at, budget_revision_id")
      .eq("token", token)
      .single();

    if (tokenError || !tokenRow) return Response.json({ error: "invalid_token" }, { status: 404, headers: cors });
    if (tokenRow.revoked_at) return Response.json({ error: "token_revoked" }, { status: 410, headers: cors });
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return Response.json({ error: "token_expired" }, { status: 410, headers: cors });
    }

    const { data: budget, error: budgetError } = await supabase
      .from("budget_revisions")
      .select("id, revision, status, total, payment_mode, payment_due_at, payment_note, work_order_id")
      .eq("id", tokenRow.budget_revision_id)
      .single();

    if (budgetError || !budget) return Response.json({ error: "budget_not_found" }, { status: 404, headers: cors });
    if (!["sent","draft","revision_requested"].includes(budget.status)) {
      return Response.json({ error: "budget_not_approvable", status: budget.status }, { status: 409, headers: cors });
    }

    const { data: existing } = await supabase
      .from("approvals")
      .select("id, decision")
      .eq("budget_revision_id", budget.id)
      .maybeSingle();
    if (existing) return Response.json({ error: "already_decided", decision: existing.decision }, { status: 409, headers: cors });

    let signaturePath: string | null = null;
    let signatureSha256: string | null = null;

    if (decision === "approved") {
      const { bytes, mime, ext } = decodeDataUrl(String(body.signatureDataUrl));
      if (bytes.byteLength < 300 || bytes.byteLength > 2_000_000) {
        return Response.json({ error: "invalid_signature_size" }, { status: 400, headers: cors });
      }
      signatureSha256 = await sha256Hex(bytes);
      signaturePath = `approvals/${budget.id}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("oficina-evidence")
        .upload(signaturePath, bytes, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
    const ipHash = ip ? await sha256Hex(new TextEncoder().encode(ip)) : null;
    const userAgent = req.headers.get("user-agent") || null;

    const { error: approvalError } = await supabase.from("approvals").insert({
      budget_revision_id: budget.id,
      approval_token_id: tokenRow.id,
      customer_name: name,
      decision,
      consent: decision === "approved" ? true : false,
      signature_path: signaturePath,
      signature_sha256: signatureSha256,
      user_agent: userAgent,
      ip_hash: ipHash,
    });
    if (approvalError) throw approvalError;

    const budgetStatus = decision === "approved" ? "approved" : "revision_requested";
    const workOrderStatus = decision === "approved" ? "approved" : "budget";

    const { error: revError } = await supabase
      .from("budget_revisions")
      .update({ status: budgetStatus, approved_at: decision === "approved" ? new Date().toISOString() : null })
      .eq("id", budget.id);
    if (revError) throw revError;

    const { error: osError } = await supabase
      .from("work_orders")
      .update({ status: workOrderStatus })
      .eq("id", budget.work_order_id);
    if (osError) throw osError;

    let receivableId: string | null = null;
    if (decision === "approved") {
      const { data: existingReceivable } = await supabase
        .from("receivables")
        .select("id")
        .eq("budget_revision_id", budget.id)
        .maybeSingle();

      if (existingReceivable?.id) {
        receivableId = existingReceivable.id;
      } else {
        const { data: receivable, error: receivableError } = await supabase
          .from("receivables")
          .insert({
            work_order_id: budget.work_order_id,
            budget_revision_id: budget.id,
            amount: Number(budget.total || 0),
            paid_amount: 0,
            status: "open",
            due_at: budget.payment_due_at || (budget.payment_mode === "pay_now" ? new Date().toISOString() : null),
          })
          .select("id")
          .single();
        if (receivableError) throw receivableError;
        receivableId = receivable.id;
      }
    }

    await supabase.from("activity_log").insert({
      work_order_id: budget.work_order_id,
      actor_type: "customer",
      event_type: decision === "approved" ? "budget_approved" : "budget_revision_requested",
      payload: {
        budget_revision_id: budget.id,
        revision: budget.revision,
        total: budget.total,
        payment_mode: budget.payment_mode || "pay_now",
        payment_due_at: budget.payment_due_at || null,
        signature_sha256: signatureSha256
      },
    });

    return Response.json({
      ok: true,
      decision,
      revision: budget.revision,
      total: budget.total,
      receivableId,
      decidedAt: new Date().toISOString(),
    }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "server_error", detail: String(error) }, { status: 500, headers: cors });
  }
});
