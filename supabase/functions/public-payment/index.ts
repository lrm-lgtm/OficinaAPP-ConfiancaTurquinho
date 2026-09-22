import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return Response.json({ error: "token_required" }, { status: 400, headers: cors });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("payment_requests")
      .select("id,work_order_id,amount,currency,status,method,pix_copy_paste,pix_qr_code_base64,payment_url,expires_at,created_at")
      .eq("public_token",token)
      .single();

    if (error || !data) return Response.json({ error: "payment_request_not_found" }, { status: 404, headers: cors });

    return Response.json({
      payment: {
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        method: data.method,
        pix: data.method === "pix" ? {
          copy_paste: data.pix_copy_paste,
          qr_code_base64: data.pix_qr_code_base64,
          ticket_url: data.payment_url,
          expires_at: data.expires_at,
        } : null,
      }
    }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "server_error", detail: String(error) }, { status: 500, headers: cors });
  }
});
