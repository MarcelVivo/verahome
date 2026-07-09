// supabase/functions/admin-resend-invite/index.ts
//
// Sends an existing contact another Vera Portal registration/password link.
// Admin-only. Uses Supabase Admin generateLink(type: "recovery") and sends
// the generated action link via Resend, so already-created contacts can set
// or reset their portal password again.

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
  if (error) return false;
  return data?.value?.mode === "test" || data?.value?.disabled === true;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { profileId } = await req.json();
    if (!profileId) return jsonResponse({ error: "profileId fehlt." }, 400);

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
    if (callerErr || !callerData?.user) return jsonResponse({ error: "Nicht angemeldet." }, 401);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("category")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfile?.category !== "admin") return jsonResponse({ error: "Keine Berechtigung." }, 403);

    const { data: contact, error: contactErr } = await adminClient
      .from("profiles")
      .select("id, first_name, last_name, company_name, email")
      .eq("id", profileId)
      .single();
    if (contactErr || !contact) return jsonResponse({ error: "Kontakt nicht gefunden." }, 404);
    if (!contact.email) return jsonResponse({ error: "Kontakt hat keine Login-E-Mail-Adresse." }, 422);

    if (await outboundEmailsDisabled(adminClient)) {
      return jsonResponse({ ok: true, skipped: true, reason: "outbound_email_mode_test", profileId });
    }

    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: contact.email,
      options: { redirectTo: "https://www.verahome.ch/portal/update-password.html" },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      return jsonResponse({ error: linkErr?.message || "Einladungslink konnte nicht erzeugt werden." }, 502);
    }

    const { error: registrationMarkErr } = await adminClient
      .from("profiles")
      .update({ portal_invited_at: new Date().toISOString() })
      .eq("id", profileId)
      .is("portal_registered_at", null);
    if (registrationMarkErr) {
      console.error("registration status update failed:", registrationMarkErr.message);
    }

    const displayName = contact.company_name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || "Kontakt";
    const actionLink = linkData.properties.action_link;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Ihr Zugang zum Vera Portal</h2>
        <p>Guten Tag ${escapeHtml(displayName)},</p>
        <p>Sie erhalten erneut einen Link, um Ihr Passwort für das Vera Portal festzulegen oder zu erneuern.</p>
        <p style="margin:20px 0;">
          <a href="${escapeHtml(actionLink)}" style="background:#1a2a40;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;">
            Zugang einrichten
          </a>
        </p>
        <p>Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="word-break:break-all;color:#35506f;font-size:13px;">${escapeHtml(actionLink)}</p>
        <p style="color:#777;font-size:12px;margin-top:24px;">Diese E-Mail wurde automatisch von Vera Home Immobilien versendet.</p>
      </div>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Vera Home Immobilien <rechnungen@verahome.ch>",
        to: [contact.email],
        subject: "Ihr Zugang zum Vera Portal",
        html,
      }),
    });

    const resendBody = await resendRes.json();
    if (!resendRes.ok) return jsonResponse({ error: "Resend-Fehler", detail: resendBody }, 502);

    return jsonResponse({ ok: true, id: resendBody.id });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
