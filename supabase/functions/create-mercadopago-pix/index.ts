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

    const { data: permissions, error: permissionsError } = await userClient.rpc("my_permissions");
    if (
      permissionsError ||
      !Array.isArray(permissions) ||
      (!permissions.includes("*") && !permissions.includes("finance.write"))
    ) {
      return json({ error: "finance_write_required" }, 403);
    }

    if (!mpAccessToken) return json({ error: "provider_not_configured", provider: "mercadopago" }, 503);

    const body = await req.json();
    const budgetRevisionId = String(body.budget_revision_id || "");
    const payerEmail = String(body.payer_email || "").trim().toLowerCase();
    const payerDocument = String(body.payer_document || "").replace(/\D/g, "");

    if (!budgetRevisionId || !payerEmail) return json({ error: "invalid_request" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) return json({ error: "invalid_payer_email" }, 400);
    if (![11, 14].includes(payerDocument.length)) return json({ error: "invalid_payer_document" }, 400);

    const admin = createClient(url, serviceRole);
    const { data: budget, error: budgetError } = await admin
      .from("budget_revisions")
      .select("id,work_order_id,total,status")
      .eq("id", budgetRevisionId)
      .single();
    if (budgetError || !budget) return json({ error: "budget_not_found" }, 404);
    if (budget.status !== "approved") return json({ error: "budget_not_approved" }, 409);

    const { data: receivable, error: receivableError } = await admin
      .from("receivables")
      .select("id,work_order_id,budget_revision_id,amount,paid_amount,status")
      .eq("budget_revision_id", budget.id)
      .maybeSingle();
    if (receivableError) throw receivableError;
    if (!receivable) return json({ error: "receivable_not_found" }, 409);
    if (String(receivable.work_order_id) !== String(budget.work_order_id)) {
      return json({ error: "receivable_budget_mismatch" }, 409);
    }
    if (receivable.status === "cancelled") return json({ error: "receivable_cancelled" }, 409);

    const amount = Math.max(0, Number(receivable.amount || 0) - Number(receivable.paid_amount || 0));
    if (!Number.isFinite(amount) || amount <= 0 || receivable.status === "paid") {
      return json({ error: "receivable_already_paid" }, 409);
    }

    const { data: existingRequest, error: existingError } = await admin
      .from("payment_requests")
      .select("id,public_token,status,amount,provider_payment_id,pix_copy_paste,pix_qr_code_base64,payment_url,expires_at")
      .eq("receivable_id", receivable.id)
      .eq("provider", "mercadopago")
      .eq("method", "pix")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existingRequest) {
      const stillValid = !existingRequest.expires_at || new Date(existingRequest.expires_at).getTime() > Date.now();
      if (stillValid && existingRequest.pix_copy_paste) {
        return json({
          ok: true,
          reused: true,
          payment_request_token: existingRequest.public_token,
          status: existingRequest.status,
          provider_payment_id: existingRequest.provider_payment_id,
          amount: Number(existingRequest.amount),
          pix: {
            copy_paste: existingRequest.pix_copy_paste,
            qr_code_base64: existingRequest.pix_qr_code_base64,
            ticket_url: existingRequest.payment_url,
            expires_at: existingRequest.expires_at,
          },
        });
      }
      if (!stillValid) {
        await admin.from("payment_requests").update({ status: "expired" }).eq("id", existingRequest.id);
      } else {
        return json({ error: "payment_request_processing" }, 409);
      }
    }

    const { data: order } = await admin
      .from("work_orders")
      .select("number")
      .eq("id", budget.work_order_id)
      .maybeSingle();

    const { data: requestRow, error: insertError } = await admin
      .from("payment_requests")
      .insert({
        work_order_id: budget.work_order_id,
        budget_revision_id: budget.id,
        receivable_id: receivable.id,
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
      description: "Auto Mecânica Confiança · OS #" + String(order?.number || ""),
      payment_method_id: "pix",
      external_reference: requestRow.id,
      notification_url: notificationUrl,
      payer: {
        email: payerEmail,
        identification: {
          type: payerDocument.length === 14 ? "CNPJ" : "CPF",
          number: payerDocument,
        },
      },
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
