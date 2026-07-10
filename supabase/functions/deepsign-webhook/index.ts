// supabase/functions/deepsign-webhook/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "deepsign-webhook" -> paste this file's contents -> Deploy.
// No secrets needed beyond the existing SUPABASE_SERVICE_ROLE_KEY.
//
// IMPORTANT -- this is a best-effort stub, not a finished integration.
// DeepSign's public API docs confirm webhook/callback support exists
// but don't spell out the exact payload shape or how the request is
// authenticated (shared secret header? signed body?). Rather than guess
// at that and silently do the wrong thing, this handler:
//   1. Always logs the full raw body (visible in Supabase Edge Function
//      logs) so a real payload can be captured once DeepSign's webhook
//      is actually configured against a live account.
//   2. Makes a best-effort attempt to update document_signature_requests
//      if it can find a recognisable document id + status in the body,
//      using the same status vocabulary as deepsign-refresh-status.
//   3. Always returns 200 regardless of whether step 2 matched anything,
//      so DeepSign doesn't retry/disable the webhook over a shape we
//      haven't confirmed yet.
//
// The reliable path for status updates today is the admin-triggered
// "Status aktualisieren" button (deepsign-refresh-status), which uses
// the well-documented GET /documents/{id} endpoint. Treat this webhook
// as a future optimization to layer on top once its real shape is
// confirmed, not the source of truth yet.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function mapStatus(documentStatus: string, signStatus: string): string {
  if (documentStatus === "signed" || signStatus === "signed") return "signed";
  if (documentStatus === "rejected" || signStatus === "rejected") return "rejected";
  if (documentStatus === "withdrawn") return "withdrawn";
  return "in_progress";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch (_e) {
    // ignore -- still ack below
  }
  console.log("deepsign-webhook received:", raw);

  try {
    const body = raw ? JSON.parse(raw) : {};
    const deepsignDocumentId = body?.documentId || body?.id;
    const documentStatus = body?.documentStatus;
    const signStatus = body?.signStatus;

    if (deepsignDocumentId && (documentStatus || signStatus)) {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const newStatus = mapStatus(documentStatus, signStatus);
      await adminClient
        .from("document_signature_requests")
        .update({
          status: newStatus,
          completed_at: newStatus === "signed" ? new Date().toISOString() : null,
        })
        .eq("deepsign_document_id", String(deepsignDocumentId));
    }
  } catch (parseErr) {
    console.warn("deepsign-webhook: payload not understood yet, logged raw body only.", parseErr);
  }

  return new Response("ok", { status: 200 });
});
