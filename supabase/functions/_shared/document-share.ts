// Sends only an authenticated portal link. Never download or attach confidential files.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c])
  );
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
  if (error) return true;
  return data?.value?.mode === "test" || data?.value?.disabled === true;
}

function suppressedEmailResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, skipped: true, reason: "outbound_email_mode_test", ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleDocumentShare(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileIds, profileIds = [], externalEmails = [] } = await req.json();
    if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > 100 ||
        !Array.isArray(profileIds) || !profileIds.length || profileIds.length > 100 ||
        !Array.isArray(externalEmails) || externalEmails.length) {
      return new Response(JSON.stringify({ error: "Bitte 1–100 Dateien und aktive Portal-Kontakte auswählen. Externe Anhänge sind deaktiviert." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      .select("category, status, archived_at")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfile?.category !== "admin" || callerProfile.status !== "active" || callerProfile.archived_at) {
      return new Response(JSON.stringify({ error: "Keine Berechtigung." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: files } = await adminClient
      .from("document_files")
      .select("id")
      .in("id", fileIds).is("archived_at", null);
    if (!files?.length) {
      return new Response(JSON.stringify({ error: "Dateien nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: recipients, error: recipientError } = await adminClient.from("profiles")
      .select("id, first_name, email").in("id", profileIds).eq("status", "active").is("archived_at", null);
    if (recipientError) throw new Error("Empfänger konnten nicht geprüft werden.");
    if (!recipients?.length) {
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

      // Service-role clients bypass RLS: check grants explicitly, send no file data.
      const { data: grants, error: grantError } = await adminClient.from("document_shares")
        .select("file_id").eq("profile_id", person.id).in("file_id", files.map((f: any) => f.id));
      if (grantError || !grants?.length) { errors.push(person.email); continue; }

      const greetingName = person.first_name ? ` ${escapeHtml(person.first_name)}` : "";
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
          <h2 style="color:#1a2a40;">Neue Dokumente für Sie freigegeben</h2>
          <p>Guten Tag${greetingName},</p>
          <p>Julia Allen (Vera Home Immobilien) hat Dokumente für Sie im Portal freigegeben:</p>
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
}
