import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseSignature(header: string) {
  let ts = "";
  let v1 = "";
  for (const part of header.split(",")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (key?.trim() === "ts") ts = value;
    if (key?.trim() === "v1") v1 = value;
  }
  return { ts, v1 };
}

async function hmacHex(secret: string, value: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function mapStatus(status: string) {
  if (status === "approved") return "approved";
  if (status === "cancelled") return "cancelled";
  if (status === "rejected") return "rejected";
  if (status === "refunded") return "refunded";
  if (status === "in_process" || status === "in_mediation") return "processing";
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataIdRaw = url.searchParams.get("data.id") || body?.data?.id || "";
    const dataId = String(dataIdRaw).toLowerCase();
    const xRequestId = req.headers.get("x-request-id") || "";
    const xSignature = req.headers.get("x-signature") || "";
    const secret = Deno.env.get("MP_WEBHOOK_SECRET");
    const accessToken = Deno.env.get("MP_ACCESS_TOKEN");

    if (!secret || !accessToken) return json({ error: "provider_not_configured" }, 503);
    if (!dataId || !xRequestId || !xSignature) return json({ error: "missing_signature_data" }, 401);

    const { ts, v1 } = parseSignature(xSignature);
    if (!ts || !v1) return json({ error: "invalid_signature_header" }, 401);

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = await hmacHex(secret, manifest);
    if (!constantTimeEqual(expected, v1)) return json({ error: "invalid_signature" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    const eventId = String(body?.id || xRequestId);
    const { data: existingEvent } = await admin
      .from("payment_webhook_events")
      .select("id,processed_at")
      .eq("provider","mercadopago")
      .eq("provider_event_id",eventId)
      .maybeSingle();

    if (existingEvent?.processed_at) return json({ ok: true, duplicate: true });

    if (!existingEvent) {
      await admin.from("payment_webhook_events").insert({
        provider: "mercadopago",
        provider_event_id: eventId,
        resource_id: dataId,
        event_type: String(body?.type || body?.action || "payment"),
        payload: body,
      });
    }

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(dataId), {
      headers: { "Authorization": "Bearer " + accessToken },
    });
    const payment = await mpResponse.json();

    if (!mpResponse.ok) {
      return json({ error: "provider_lookup_failed" }, 502);
    }

    const providerPaymentId = String(payment.id);
    const status = mapStatus(String(payment.status || "pending"));

    const { data: requestRow } = await admin
      .from("payment_requests")
      .select("id,receivable_id,work_order_id,amount")
      .eq("provider","mercadopago")
      .eq("provider_payment_id",providerPaymentId)
      .maybeSingle();

    if (requestRow) {
      await admin.from("payment_requests").update({
        status,
        provider_payload: payment,
      }).eq("id",requestRow.id);

      await admin.from("payments").upsert({
        receivable_id: requestRow.receivable_id,
        work_order_id: requestRow.work_order_id,
        provider: "mercadopago",
        provider_payment_id: providerPaymentId,
        provider_status: String(payment.status || ""),
        amount: Number(payment.transaction_amount || requestRow.amount || 0),
        method: "pix",
        status,
        paid_at: status === "approved" ? (payment.date_approved || new Date().toISOString()) : null,
        payload: payment,
      }, { onConflict: "provider,provider_payment_id" });

      if (requestRow.receivable_id && status === "approved") {
        const { data: receivable } = await admin
          .from("receivables")
          .select("id,amount,paid_amount")
          .eq("id",requestRow.receivable_id)
          .single();
        if (receivable) {
          const paid = Math.min(Number(receivable.amount), Number(receivable.paid_amount||0) + Number(payment.transaction_amount||0));
          await admin.from("receivables").update({
            paid_amount: paid,
            status: paid >= Number(receivable.amount) ? "paid" : "partial",
          }).eq("id",receivable.id);
        }
      }
    }

    await admin.from("payment_webhook_events").update({
      processed_at: new Date().toISOString(),
    }).eq("provider","mercadopago").eq("provider_event_id",eventId);

    return json({ ok: true });
  } catch (error) {
    return json({ error: "server_error", detail: String(error) }, 500);
  }
});
