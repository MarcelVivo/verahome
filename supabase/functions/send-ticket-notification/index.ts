// supabase/functions/send-ticket-notification/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-ticket-notification" -> paste this file's contents
// -> Deploy. Reuses the same RESEND_API_KEY secret already set for the
// other functions — no new secret needed.
//
// Triggered right after an admin creates an internal ticket (Vera
// Portal "Tickets" page). Emails every admin profile in the database
// PLUS a fixed, always-included address (kontakt@marcelspahr.ch) —
// that address is not tied to any profile, so it's hardcoded here
// rather than looked up, and always added regardless of how many
// admin accounts exist or what their emails are.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALWAYS_NOTIFY_EMAIL = "kontakt@marcelspahr.ch";

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c])
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { ticketId } = await req.json();
    if (!ticketId) {
      return new Response(JSON.stringify({ error: "ticketId fehlt." }), {
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

    const { data: ticket, error: ticketErr } = await adminClient
      .from("admin_tickets")
      .select("*, creator:profiles!created_by(first_name, last_name)")
      .eq("id", ticketId)
      .single();
    if (ticketErr || !ticket) {
      return new Response(JSON.stringify({ error: "Ticket nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminProfiles } = await adminClient
      .from("profiles")
      .select("email")
      .eq("category", "admin");

    const recipients = Array.from(
      new Set(
        (adminProfiles || [])
          .map((p: any) => p.email)
          .filter(Boolean)
          .concat([ALWAYS_NOTIFY_EMAIL])
      )
    );

    const creatorName = ticket.creator ? `${ticket.creator.first_name} ${ticket.creator.last_name}` : "Unbekannt";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Neues Ticket</h2>
        <table style="margin:12px 0;"><tbody>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Titel</td><td><strong>${escapeHtml(ticket.title)}</strong></td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Erstellt von</td><td>${escapeHtml(creatorName)}</td></tr>
        </tbody></table>
        <p><strong>Beschreibung:</strong><br>${escapeHtml(ticket.description).replace(/\n/g, "<br>")}</p>
        <p style="margin-top:16px;">
          <a href="https://www.verahome.ch/portal/admin/tickets.html" style="background:#1a2a40;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">
            Ticket im Vera Portal öffnen
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
        to: recipients,
        subject: `Neues Ticket: ${ticket.title}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "Resend-Fehler" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, sentTo: recipients }), {
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
