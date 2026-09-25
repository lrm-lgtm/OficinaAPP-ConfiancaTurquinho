import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function hasPermission(permissions: unknown, permission: string) {
  return Array.isArray(permissions) && (permissions.includes("*") || permissions.includes(permission));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "authorization_required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpAccessToken) return json({ error: "provider_not_configured" }, 503);

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const userId = authData.user?.id || null;
    if (authError || !userId) return json({ error: "authorization_required" }, 401);

    const { data: staffProfile, error: staffError } = await userClient
      .from("staff_profiles")
      .select("id,active")
      .eq("id", userId)
      .maybeSingle();
    if (staffError || !staffProfile?.active) return json({ error: "staff_access_required" }, 403);

    const { data: permissions, error: permissionsError } = await userClient.rpc("my_permissions");
    if (
      permissionsError ||
      !hasPermission(permissions, "work_orders.write_all") ||
      !hasPermission(permissions, "finance.write")
    ) {
      return json({ error: "finance_adjustment_not_allowed" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "cancel_pending") {
      const paymentRequestId = String(body.payment_request_id || "");
      if (!paymentRequestId) return json({ error: "payment_request_required" }, 400);

      const { data: paymentRequest, error: requestError } = await admin
        .from("payment_requests")
        .select("id,work_order_id,provider,status,provider_payment_id,amount")
        .eq("id", paymentRequestId)
        .single();
      if (requestError || !paymentRequest) return json({ error: "payment_request_not_found" }, 404);
      if (paymentRequest.provider !== "mercadopago") return json({ error: "unsupported_provider" }, 409);
      if (["cancelled","expired","rejected","refunded"].includes(String(paymentRequest.status))) {
        return json({ ok: true, reused: true, status: paymentRequest.status });
      }
      if (!["pending","processing","draft","provider_error"].includes(String(paymentRequest.status))) {
        return json({ error: "payment_request_not_cancellable" }, 409);
      }

      let adjustmentRequest: any = null;
      const { data: existing } = await admin
        .from("provider_payment_adjustment_requests")
        .select("id,status,provider_reference")
        .eq("payment_request_id", paymentRequest.id)
        .eq("action", "cancel_pending")
        .in("status", ["processing","provider_error"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      adjustmentRequest = existing;
      if (!adjustmentRequest) {
        const { data: created, error: createError } = await admin
          .from("provider_payment_adjustment_requests")
          .insert({
            work_order_id: paymentRequest.work_order_id,
            payment_request_id: paymentRequest.id,
            provider: "mercadopago",
            action: "cancel_pending",
            amount: paymentRequest.amount,
            status: "processing",
            created_by: userId,
          })
          .select("id,status,provider_reference")
          .single();
        if (createError || !created) throw createError || new Error("adjustment_request_insert_failed");
        adjustmentRequest = created;
      } else {
        await admin.from("provider_payment_adjustment_requests")
          .update({ status: "processing" })
          .eq("id", adjustmentRequest.id);
      }

      let providerPayload: any = { status: "cancelled", local_only: true };
      if (paymentRequest.provider_payment_id) {
        const response = await fetch(
          "https://api.mercadopago.com/v1/payments/" + encodeURIComponent(paymentRequest.provider_payment_id),
          {
            method: "PUT",
            headers: {
              "Authorization": "Bearer " + mpAccessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "cancelled" }),
          },
        );
        providerPayload = await response.json().catch(() => ({}));
        if (!response.ok) {
          await admin.from("provider_payment_adjustment_requests").update({
            status: "provider_error",
            provider_payload: providerPayload,
          }).eq("id", adjustmentRequest.id);
          return json({ error: "mercadopago_cancel_error", provider_response: providerPayload }, 502);
        }
      }

      await admin.from("payment_requests").update({
        status: "cancelled",
        provider_payload: providerPayload,
      }).eq("id", paymentRequest.id);

      if (paymentRequest.provider_payment_id) {
        await admin.from("payments").update({
          status: "cancelled",
          provider_status: "cancelled",
          payload: providerPayload,
        })
          .eq("provider", "mercadopago")
          .eq("provider_payment_id", paymentRequest.provider_payment_id);
      }

      await admin.from("provider_payment_adjustment_requests").update({
        status: "approved",
        provider_reference: paymentRequest.provider_payment_id || null,
        provider_payload: providerPayload,
      }).eq("id", adjustmentRequest.id);

      await admin.from("activity_log").insert({
        work_order_id: paymentRequest.work_order_id,
        actor_user_id: userId,
        actor_type: "user",
        event_type: "cancellation_provider_payment_cancelled",
        payload: {
          payment_request_id: paymentRequest.id,
          provider_payment_id: paymentRequest.provider_payment_id,
          adjustment_request_id: adjustmentRequest.id,
        },
      });

      return json({ ok: true, status: "cancelled" });
    }

    if (action === "refund") {
      const paymentId = String(body.payment_id || "");
      if (!paymentId) return json({ error: "payment_required" }, 400);

      const { data: payment, error: paymentError } = await admin
        .from("payments")
        .select("id,work_order_id,provider,provider_payment_id,status,amount,method")
        .eq("id", paymentId)
        .single();
      if (paymentError || !payment) return json({ error: "payment_not_found" }, 404);
      if (payment.provider !== "mercadopago" || !payment.provider_payment_id) {
        return json({ error: "provider_refund_not_available" }, 409);
      }
      if (!["approved","partially_refunded"].includes(String(payment.status))) {
        return json({ error: "payment_not_refundable" }, 409);
      }

      const { data: refunds, error: refundsError } = await admin
        .from("payment_refunds")
        .select("amount")
        .eq("payment_id", payment.id)
        .eq("status", "approved");
      if (refundsError) throw refundsError;

      const refunded = (refunds || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const remaining = Math.max(0, Number(payment.amount) - refunded);
      const requested = Number(body.amount || remaining);
      if (!Number.isFinite(requested) || requested <= 0 || requested > remaining) {
        return json({ error: "invalid_refund_amount", remaining }, 400);
      }

      let adjustmentRequest: any = null;
      const { data: existing } = await admin
        .from("provider_payment_adjustment_requests")
        .select("id,status,provider_reference")
        .eq("payment_id", payment.id)
        .eq("action", "refund")
        .eq("amount", requested)
        .in("status", ["processing","provider_error"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      adjustmentRequest = existing;
      if (!adjustmentRequest) {
        const { data: created, error: createError } = await admin
          .from("provider_payment_adjustment_requests")
          .insert({
            work_order_id: payment.work_order_id,
            payment_id: payment.id,
            provider: "mercadopago",
            action: "refund",
            amount: requested,
            status: "processing",
            created_by: userId,
          })
          .select("id,status,provider_reference")
          .single();
        if (createError || !created) throw createError || new Error("adjustment_request_insert_failed");
        adjustmentRequest = created;
      } else {
        await admin.from("provider_payment_adjustment_requests")
          .update({ status: "processing" })
          .eq("id", adjustmentRequest.id);
      }

      const fullOriginalRefund = refunded === 0 && requested >= Number(payment.amount);
      const response = await fetch(
        "https://api.mercadopago.com/v1/payments/" + encodeURIComponent(payment.provider_payment_id) + "/refunds",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + mpAccessToken,
            "Content-Type": "application/json",
            "X-Idempotency-Key": adjustmentRequest.id,
          },
          body: fullOriginalRefund ? "{}" : JSON.stringify({ amount: requested }),
        },
      );
      const providerPayload = await response.json().catch(() => ({}));

      if (!response.ok) {
        await admin.from("provider_payment_adjustment_requests").update({
          status: "provider_error",
          provider_payload: providerPayload,
        }).eq("id", adjustmentRequest.id);
        return json({
          error: "mercadopago_refund_error",
          remaining,
          provider_response: providerPayload,
        }, 502);
      }

      const providerRefundId = String(providerPayload?.id || "");
      if (!providerRefundId) {
        await admin.from("provider_payment_adjustment_requests").update({
          status: "provider_error",
          provider_payload: providerPayload,
        }).eq("id", adjustmentRequest.id);
        return json({ error: "provider_refund_id_missing" }, 502);
      }

      const { data: existingRefund } = await admin
        .from("payment_refunds")
        .select("id")
        .eq("provider", "mercadopago")
        .eq("provider_refund_id", providerRefundId)
        .maybeSingle();

      if (!existingRefund) {
        const { error: recordError } = await admin.rpc("record_provider_cancellation_refund", {
          p_payment_id: payment.id,
          p_amount: requested,
          p_provider_refund_id: providerRefundId,
          p_payload: providerPayload,
        });
        if (recordError) throw recordError;
      }

      const newRefunded = refunded + requested;
      const mappedStatus = newRefunded >= Number(payment.amount) ? "refunded" : "partially_refunded";

      await admin.from("payment_requests").update({
        status: mappedStatus,
        provider_payload: providerPayload,
      })
        .eq("provider", "mercadopago")
        .eq("provider_payment_id", payment.provider_payment_id);

      await admin.from("provider_payment_adjustment_requests").update({
        status: "approved",
        provider_reference: providerRefundId,
        provider_payload: providerPayload,
      }).eq("id", adjustmentRequest.id);

      return json({
        ok: true,
        status: mappedStatus,
        refunded_amount: requested,
        remaining: Math.max(0, Number(payment.amount) - newRefunded),
        provider_refund_id: providerRefundId,
      });
    }

    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    return json({ error: "server_error", detail: String(error) }, 500);
  }
});
