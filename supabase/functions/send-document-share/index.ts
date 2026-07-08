// supabase/functions/send-document-share/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-document-share" -> paste this file's contents ->
// Deploy. Reuses the same RESEND_API_KEY secret already set for the
// other functions — no new secret needed.
//
// Triggered by the admin right after sharing one or more files (Vera
// Portal "Dokumente" folder system) with one or more recipients.
// Downloads each file from the private 'document-vault' storage
// bucket and attaches it to the recipient's email as a real copy —
// per the "immer doppelt versendet" requirement (in-portal + email).
// If a recipient's combined attachments would exceed a safe size
// budget, attachments are dropped in favor of a plain "open in portal"
// link instead, so the email never silently fails to send.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Resend caps combined attachments around ~40MB; stay well under that
// (base64 inflates raw bytes by ~33%) so the request itself never gets
// rejected for a reason we didn't already account for.
const MAX_ATTACHMENT_BYTES_PER_EMAIL = 25 * 1024 * 1024;

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c])
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function envFlagEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(Deno.env.get(name) ?? "").toLowerCase());
}

async function outboundEmailsDisabled(adminClient: any): Promise<boolean> {
  if (envFlagEnabled("DISABLE_OUTBOUND_EMAILS")) return true;
  const { data, error } = await adminClient
    .from("portal_settings")
    .select("value")
    .eq("key", "outbound_email_mode")
    .maybeSingle();
  if (error) return false;
  return data?.value?.mode === "test" || data?.value?.disabled === true;
}

function suppressedEmailResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, skipped: true, reason: "outbound_email_mode_test", ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileIds, profileIds = [], externalEmails = [] } = await req.json();
    const cleanExternalEmails = Array.isArray(externalEmails)
      ? externalEmails.map((e: unknown) => String(e ?? "").trim()).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      : [];
    if (!Array.isArray(fileIds) || !fileIds.length || (!Array.isArray(profileIds) || !profileIds.length) && !cleanExternalEmails.length) {
      return new Response(JSON.stringify({ error: "fileIds und Empfänger sind erforderlich." }), {
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
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

    const { data: files } = await adminClient
      .from("document_files")
      .select("id, title, file_path, mime_type, size_bytes")
      .in("id", fileIds);
    if (!files?.length) {
      return new Response(JSON.stringify({ error: "Dateien nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profileRecipients } = Array.isArray(profileIds) && profileIds.length
      ? await adminClient.from("profiles").select("id, first_name, email").in("id", profileIds)
      : { data: [] };
    const recipients = [
      ...(profileRecipients ?? []),
      ...cleanExternalEmails.map((email: string) => ({ id: null, first_name: "", email }))
    ];
    if (!recipients.length) {
      return new Response(JSON.stringify({ error: "Empfänger nicht gefunden oder ungültig." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (await outboundEmailsDisabled(adminClient)) {
      return suppressedEmailResponse({ skippedCount: recipients.filter((p: any) => p.email).length });
    }

    let sent = 0;
    const errors: string[] = [];

    for (const person of recipients) {
      if (!person.email) continue;

      const attachments: { filename: string; content: string }[] = [];
      const linkOnlyFiles: string[] = [];
      let totalBytes = 0;

      for (const file of files) {
        const declaredSize = file.size_bytes || 0;
        if (totalBytes + declaredSize > MAX_ATTACHMENT_BYTES_PER_EMAIL) {
          linkOnlyFiles.push(file.title);
          continue;
        }
        const { data: blob, error: dlErr } = await adminClient.storage
          .from("document-vault")
          .download(file.file_path);
        if (dlErr || !blob) {
          linkOnlyFiles.push(file.title);
          continue;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (totalBytes + bytes.length > MAX_ATTACHMENT_BYTES_PER_EMAIL) {
          linkOnlyFiles.push(file.title);
          continue;
        }
        totalBytes += bytes.length;
        attachments.push({
          filename: file.title,
          content: bytesToBase64(bytes),
        });
      }

      const attachedListHtml = attachments.length
        ? "<ul>" + attachments.map((a) => `<li>${escapeHtml(a.filename)} (im Anhang)</li>`).join("") + "</ul>"
        : "";
      const linkOnlyListHtml = linkOnlyFiles.length
        ? "<ul>" + linkOnlyFiles.map((t) => `<li>${escapeHtml(t)} (zu gross zum Anhängen, im Portal öffnen)</li>`).join("") + "</ul>"
        : "";

      const greetingName = person.first_name ? ` ${escapeHtml(person.first_name)}` : "";
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
          <h2 style="color:#1a2a40;">Neue Dokumente für Sie freigegeben</h2>
          <p>Guten Tag${greetingName},</p>
          <p>Julia Allen (Vera Home Immobilien) hat folgende Dokumente mit Ihnen geteilt:</p>
          ${attachedListHtml}
          ${linkOnlyListHtml}
          <p style="margin-top:16px;">
            <a href="https://www.verahome.ch/portal/documents.html" style="background:#1a2a40;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">
              Im Vera Portal öffnen
            </a>
          </p>
          <p style="color:#777;font-size:12px;margin-top:24px;">
            Diese E-Mail wurde automatisch von Vera Home Immobilien versendet.
          </p>
        </div>`;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Vera Home Immobilien <rechnungen@verahome.ch>",
          to: [person.email],
          subject: "Neue Dokumente für Sie freigegeben",
          html,
          attachments: attachments.length ? attachments : undefined,
        }),
      });

      if (resendRes.ok) {
        sent++;
      } else {
        errors.push(person.email);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed: errors }), {
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
