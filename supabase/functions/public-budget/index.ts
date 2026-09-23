import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return Response.json({ error: "token_required" }, { status: 400, headers: cors });

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
      .select(`
        id, revision, status, subtotal, total, payment_mode, payment_due_at, payment_note, work_order_id,
        budget_items(id, kind, description, quantity, unit_price, line_total, sort_order),
        work_orders!inner(id, number, status, customer_id, vehicle_id,
          customers!inner(id, name),
          vehicles(id, plate, make, model, version, year)
        )
      `)
      .eq("id", tokenRow.budget_revision_id)
      .single();

    if (budgetError || !budget) return Response.json({ error: "budget_not_found" }, { status: 404, headers: cors });

    const { data: approval } = await supabase
      .from("approvals")
      .select("customer_name, decision, consent, created_at")
      .eq("budget_revision_id", budget.id)
      .maybeSingle();

    const { data: paymentRequest } = await supabase
      .from("payment_requests")
      .select("public_token,status,amount,method,pix_copy_paste,pix_qr_code_base64,payment_url,expires_at,created_at")
      .eq("budget_revision_id", budget.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return Response.json({
      budget: {
        id: budget.id,
        revision: budget.revision,
        status: budget.status,
        total: budget.total,
        payment_mode: budget.payment_mode || "pay_now",
        payment_due_at: budget.payment_due_at,
        payment_note: budget.payment_note,
        items: [...(budget.budget_items || [])].sort((a,b)=>a.sort_order-b.sort_order),
        order: {
          id: budget.work_orders.id,
          number: budget.work_orders.number,
          status: budget.work_orders.status,
          customer: budget.work_orders.customers,
          vehicle: budget.work_orders.vehicles,
        },
      },
      approval,
      payment_request: paymentRequest || null,
    }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "server_error", detail: String(error) }, { status: 500, headers: cors });
  }
});
