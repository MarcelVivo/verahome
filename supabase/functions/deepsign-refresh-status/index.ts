// supabase/functions/deepsign-refresh-status/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "deepsign-refresh-status" -> paste this file's contents ->
// Deploy. Needs the same DEEPSIGN_CLIENT_ID/DEEPSIGN_CLIENT_SECRET/
// DEEPSIGN_USERNAME/DEEPSIGN_PASSWORD secrets as deepsign-create-request.
//
// Triggered by the admin clicking "Status aktualisieren" on a pending
// signature request in the Dokumenten-Tresor. DeepSign's own webhook
// mechanism exists but its exact payload shape isn't nailed down in the
// public API docs (see deepsign-webhook/index.ts for the best-effort
// receiver) -- this manual/polling path uses the well-documented
// GET /documents/{id} status endpoint instead, so status tracking works
// reliably even before the webhook has been verified against a real
// account. DeepSign rate-limits polling GETs to once per 15 minutes per
// their docs, so this is meant to be admin-triggered on demand, not
// auto-polled on a timer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEEPSIGN_TOKEN_URL = "https://deepcloud.swiss/auth/realms/sso/protocol/openid-connect/token";
const DEEPSIGN_API_BASE = "https://api.sign.deepbox.swiss/api/v1";

// DeepSign's documentStatus/signStatus vocabulary mapped onto our own
// smaller status set. "signed" only once DeepSign itself reports the
// document as fully signed -- everything still in flight stays
// "in_progress" so a partial per-signee state doesn't get reported as
// more final than it is.
function mapStatus(documentStatus: string, signStatus: string): string {
  if (documentStatus === "signed" || signStatus === "signed") return "signed";
  if (documentStatus === "rejected" || signStatus === "rejected") return "rejected";
  if (documentStatus === "withdrawn") return "withdrawn";
  return "in_progress";
}

async function getDeepsignToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: Deno.env.get("DEEPSIGN_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("DEEPSIGN_CLIENT_SECRET") ?? "",
    username: Deno.env.get("DEEPSIGN_USERNAME") ?? "",
    password: Deno.env.get("DEEPSIGN_PASSWORD") ?? "",
  });
  const res = await fetch(DEEPSIGN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`DeepSign-Anmeldung fehlgeschlagen (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  if (!json?.access_token) throw new Error("DeepSign-Anmeldung: kein access_token erhalten.");
  return json.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id ist erforderlich." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) {
      return new Response(JSON.stringify({ error: "Nicht angemeldet." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("category")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfile?.category !== "admin") {
      return new Response(JSON.stringify({ error: "Keine Berechtigung." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: request, error: reqErr } = await adminClient
      .from("document_signature_requests")
      .select("id, deepsign_document_id, status")
      .eq("id", request_id)
      .single();
    if (reqErr || !request?.deepsign_document_id) {
      return new Response(JSON.stringify({ error: "Signaturanfrage nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let token: string;
    try {
      token = await getDeepsignToken();
    } catch (authErr) {
      return new Response(JSON.stringify({ error: String((authErr as Error).message || authErr) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const statusRes = await fetch(`${DEEPSIGN_API_BASE}/documents/${request.deepsign_document_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!statusRes.ok) {
      return new Response(JSON.stringify({ error: `DeepSign-Statusabfrage fehlgeschlagen (${statusRes.status}): ${await statusRes.text()}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const remote = await statusRes.json();
    const newStatus = mapStatus(remote?.documentStatus, remote?.signStatus);

    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === "signed" && !remote?.completedAtMissing) {
      updatePayload.completed_at = new Date().toISOString();
    }
    await adminClient.from("document_signature_requests").update(updatePayload).eq("id", request.id);

    // Best-effort: falls die Antwort eine signees-Liste mit E-Mail +
    // Status enthaelt, gleich mit uebernehmen. Feldnamen sind aus der
    // oeffentlichen Doku nicht 100% sicher -- schlaegt das fehl, bleibt
    // der Haupt-Request-Status trotzdem korrekt aktualisiert.
    try {
      const remoteSignees = Array.isArray(remote?.signees) ? remote.signees : [];
      for (const rs of remoteSignees) {
        const email = String(rs?.email || "").trim().toLowerCase();
        if (!email) continue;
        const signeeStatus = rs?.signStatus === "signed" ? "signed" : rs?.signStatus === "rejected" ? "rejected" : "pending";
        await adminClient.from("document_signature_signees")
          .update({ status: signeeStatus, signed_at: signeeStatus === "signed" ? new Date().toISOString() : null })
          .eq("request_id", request.id)
          .eq("email", email);
      }
    } catch (_signeeErr) {
      // ignorieren -- Hauptstatus ist bereits gespeichert.
    }

    return new Response(JSON.stringify({ ok: true, status: newStatus, raw: remote }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
