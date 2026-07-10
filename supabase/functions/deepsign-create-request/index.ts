// supabase/functions/deepsign-create-request/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "deepsign-create-request" -> paste this file's contents ->
// Deploy. Needs FOUR new secrets set under Edge Functions -> Secrets
// (obtained from the DeepSign service-account setup, see
// https://apidocs.deepcloud.swiss/deepsign-api-docs/index.html):
//   DEEPSIGN_CLIENT_ID
//   DEEPSIGN_CLIENT_SECRET
//   DEEPSIGN_USERNAME
//   DEEPSIGN_PASSWORD
// Also reuses the existing SUPABASE_SERVICE_ROLE_KEY — no separate
// secret needed for that part.
//
// Triggered by the admin's "Zur Unterschrift senden" action on a
// document in the Dokumenten-Tresor (portal/admin/properties.html).
// Downloads the chosen PDF from the private 'document-vault' storage
// bucket, uploads it to DeepSign, adds the chosen signees, and starts
// the signing process. DeepSign then emails each signee directly with
// their own signing link -- the actual signing happens outside the
// portal. This function only records the resulting request so its
// status can be tracked/refreshed from within the portal (see
// deepsign-refresh-status).
//
// signatureMode defaults to "advanced" (fortgeschrittene elektronische
// Signatur/FES) rather than "qualified" (QES) -- FES is materially
// cheaper per DeepSign's pricing and legally sufficient for documents
// without an explicit Schriftformerfordernis under Swiss OR. Pass
// signature_mode: "qualified" explicitly from the caller for documents
// that need the handwritten-signature-equivalent (e.g. certain
// termination notices) -- this is a business/legal judgment call per
// document, not something to hardcode here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEEPSIGN_TOKEN_URL = "https://deepcloud.swiss/auth/realms/sso/protocol/openid-connect/token";
const DEEPSIGN_API_BASE = "https://api.sign.deepbox.swiss/api/v1";
const VALID_SIGNATURE_MODES = ["timestamp", "advanced", "qualified"];

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

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
    const { file_id, signees, signature_mode, comment } = await req.json();

    if (!file_id || !Array.isArray(signees) || signees.length === 0) {
      return new Response(JSON.stringify({ error: "file_id und mindestens ein/e Unterzeichner/in sind erforderlich." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cleanSignees = signees
      .map((s: any) => ({
        profile_id: s?.profile_id || null,
        email: String(s?.email || "").trim().toLowerCase(),
      }))
      .filter((s: any) => s.email);
    if (cleanSignees.length === 0) {
      return new Response(JSON.stringify({ error: "Mindestens eine gültige E-Mail-Adresse ist erforderlich." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode = VALID_SIGNATURE_MODES.includes(signature_mode) ? signature_mode : "advanced";

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

    const { data: file, error: fileErr } = await adminClient
      .from("document_files")
      .select("id, title, file_path, mime_type")
      .eq("id", file_id)
      .is("archived_at", null)
      .single();
    if (fileErr || !file) {
      return new Response(JSON.stringify({ error: "Dokument nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (file.mime_type && file.mime_type !== "application/pdf") {
      return new Response(JSON.stringify({ error: "Nur PDF-Dokumente können zur Unterschrift gesendet werden." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: blob, error: dlErr } = await adminClient.storage
      .from("document-vault")
      .download(file.file_path);
    if (dlErr || !blob) {
      return new Response(JSON.stringify({ error: "Dokument konnte nicht aus dem Speicher geladen werden: " + (dlErr?.message || "unbekannter Fehler") }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fileBytes = new Uint8Array(await blob.arrayBuffer());

    let token: string;
    try {
      token = await getDeepsignToken();
    } catch (authErr) {
      return new Response(JSON.stringify({ error: String((authErr as Error).message || authErr) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uploadForm = new FormData();
    uploadForm.append("data", new Blob([JSON.stringify({
      initiatorAliasName: "Vera Home Immobilien",
      sendMail: true,
      comment: comment || "",
      signatureMode: mode,
      jurisdiction: "zertes",
    })], { type: "application/json" }));
    uploadForm.append("file", new Blob([fileBytes], { type: "application/pdf" }), file.title.endsWith(".pdf") ? file.title : file.title + ".pdf");

    const uploadRes = await fetch(`${DEEPSIGN_API_BASE}/documents/file`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: uploadForm,
    });
    if (!uploadRes.ok) {
      return new Response(JSON.stringify({ error: `DeepSign-Upload fehlgeschlagen (${uploadRes.status}): ${await uploadRes.text()}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uploaded = await uploadRes.json();
    const deepsignDocumentId = uploaded?.id || uploaded?.documentId;
    if (!deepsignDocumentId) {
      return new Response(JSON.stringify({ error: "DeepSign-Upload lieferte keine Dokument-ID zurück." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ab hier wurde bei DeepSign bereits ein Dokument angelegt -- die
    // Anfrage-Zeile wird jetzt schon eingefuegt (Status "draft"), damit
    // ein spaeterer Fehler (Signees/Start) das DeepSign-Dokument nicht
    // unsichtbar im Portal zurueck laesst.
    const { data: requestRow, error: insertErr } = await adminClient
      .from("document_signature_requests")
      .insert({
        file_id,
        deepsign_document_id: String(deepsignDocumentId),
        status: "draft",
        signature_mode: mode,
        comment: comment || null,
        created_by: callerData.user.id,
      })
      .select()
      .single();
    if (insertErr || !requestRow) {
      return new Response(JSON.stringify({ error: "Signaturanfrage konnte nicht gespeichert werden: " + (insertErr?.message || "unbekannter Fehler") }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (let i = 0; i < cleanSignees.length; i++) {
      const signee = cleanSignees[i];
      const signeeRes = await fetch(`${DEEPSIGN_API_BASE}/documents/${deepsignDocumentId}/signees`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: signee.email, signOrder: i + 1 }),
      });
      if (!signeeRes.ok) {
        await adminClient.from("document_signature_requests").update({
          status: "error",
          error_message: `Unterzeichner/in ${signee.email} konnte nicht hinzugefügt werden (${signeeRes.status}).`,
        }).eq("id", requestRow.id);
        return new Response(JSON.stringify({ error: `Unterzeichner/in ${signee.email} konnte nicht hinzugefügt werden (${signeeRes.status}): ${await signeeRes.text()}`, requestId: requestRow.id }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.from("document_signature_signees").insert({
        request_id: requestRow.id,
        profile_id: signee.profile_id,
        email: signee.email,
        sign_order: i + 1,
      });
    }

    const startRes = await fetch(`${DEEPSIGN_API_BASE}/documents/${deepsignDocumentId}/start`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!startRes.ok) {
      await adminClient.from("document_signature_requests").update({
        status: "error",
        error_message: `Signaturprozess konnte nicht gestartet werden (${startRes.status}).`,
      }).eq("id", requestRow.id);
      return new Response(JSON.stringify({ error: `Signaturprozess konnte nicht gestartet werden (${startRes.status}): ${await startRes.text()}`, requestId: requestRow.id }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient.from("document_signature_requests").update({ status: "in_progress" }).eq("id", requestRow.id);

    return new Response(JSON.stringify({ ok: true, requestId: requestRow.id, deepsignDocumentId }), {
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
