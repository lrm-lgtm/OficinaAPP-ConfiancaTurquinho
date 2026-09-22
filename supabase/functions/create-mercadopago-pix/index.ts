import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "authorization_required" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const userId = authData.user?.id || null;
    if (authError || !userId) return json({ error: "authorization_required" }, 401);

    const { data: staffProfile, error: staffError } = await userClient
      .from("staff_profiles")
      .select("id,active")
      .eq("id",userId)
      .maybeSingle();
    if (staffError || !staffProfile?.active) return json({ error: "staff_access_required" }, 403);

    if (!mpAccessToken) return json({ error: "provider_not_configured", provider: "mercadopago" }, 503);

    const body = await req.json();
    const workOrderId = String(body.work_order_id || "");
    const budgetRevisionId = body.budget_revision_id ? String(body.budget_revision_id) : null;
    const receivableId = body.receivable_id ? String(body.receivable_id) : null;
    const payerEmail = String(body.payer_email || "").trim();
    const payerDocument = String(body.payer_document || "").replace(/\D/g, "");
    const amount = Number(body.amount || 0);

    if (!workOrderId || !payerEmail || !Number.isFinite(amount) || amount <= 0) {
      return json({ error: "invalid_request" }, 400);
    }

    const admin = createClient(url, serviceRole);
    const { data: requestRow, error: insertError } = await admin
      .from("payment_requests")
      .insert({
        work_order_id: workOrderId,
        budget_revision_id: budgetRevisionId,
        receivable_id: receivableId,
        provider: "mercadopago",
        method: "pix",
        amount,
        payer_email: payerEmail,
        status: "draft",
        created_by: userId,
      })
      .select("id,public_token,idempotency_key")
      .single();

    if (insertError || !requestRow) throw insertError || new Error("payment_request_insert_failed");

    const notificationUrl = url + "/functions/v1/mercadopago-webhook";
    const paymentBody: Record<string, unknown> = {
      transaction_amount: amount,
      description: String(body.description || "Serviço automotivo"),
      payment_method_id: "pix",
      external_reference: requestRow.id,
      notification_url: notificationUrl,
      payer: {
        email: payerEmail,
        ...(payerDocument ? {
          identification: { type: "CPF", number: payerDocument }
        } : {})
      }
    };

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + mpAccessToken,
        "Content-Type": "application/json",
        "X-Idempotency-Key": requestRow.idempotency_key,
      },
      body: JSON.stringify(paymentBody),
    });

    const mpPayload = await mpResponse.json();

    if (!mpResponse.ok) {
      await admin.from("payment_requests").update({
        status: "provider_error",
        provider_payload: mpPayload,
      }).eq("id", requestRow.id);
      return json({ error: "mercadopago_error", provider_response: mpPayload }, 502);
    }

    const tx = mpPayload?.point_of_interaction?.transaction_data || {};
    const providerStatus = String(mpPayload?.status || "pending");
    const mappedStatus = providerStatus === "approved"
      ? "approved"
      : ["cancelled","rejected"].includes(providerStatus)
        ? providerStatus
        : providerStatus === "in_process" ? "processing" : "pending";

    const { error: updateError } = await admin.from("payment_requests").update({
      status: mappedStatus,
      provider_payment_id: String(mpPayload.id),
      pix_copy_paste: tx.qr_code || null,
      pix_qr_code_base64: tx.qr_code_base64 || null,
      payment_url: tx.ticket_url || null,
      expires_at: mpPayload.date_of_expiration || null,
      provider_payload: mpPayload,
    }).eq("id", requestRow.id);

    if (updateError) throw updateError;

    await admin.from("payments").insert({
      receivable_id: receivableId,
      work_order_id: workOrderId,
      provider: "mercadopago",
      provider_payment_id: String(mpPayload.id),
      provider_status: providerStatus,
      amount,
      method: "pix",
      status: mappedStatus,
      payload: mpPayload,
    });

    return json({
      ok: true,
      payment_request_token: requestRow.public_token,
      status: mappedStatus,
      provider_payment_id: String(mpPayload.id),
      amount,
      pix: {
        copy_paste: tx.qr_code || null,
        qr_code_base64: tx.qr_code_base64 || null,
        ticket_url: tx.ticket_url || null,
        expires_at: mpPayload.date_of_expiration || null,
      },
    });
  } catch (error) {
    return json({ error: "server_error", detail: String(error) }, 500);
  }
});
