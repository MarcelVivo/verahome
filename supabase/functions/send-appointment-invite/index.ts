// supabase/functions/send-appointment-invite/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-appointment-invite" -> paste this file's contents
// -> Deploy. Reuses the same RESEND_API_KEY secret already set for the
// other booking/invoice functions — no new secret needed.
//
// Triggered by the admin right after creating an appointment with one
// or more invited participants (Vera Portal "Termine" calendar). Emails
// every invited participant individually, listing who else is invited
// and pointing them to the Vera Portal to confirm. Like
// send-booking-confirmation/-reschedule, the caller must be verified as
// admin since this emails other people on the admin's behalf.

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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
    const { appointmentId } = await req.json();
    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "appointmentId fehlt." }), {
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

    const { data: appointment, error: apptErr } = await adminClient
      .from("appointments")
      .select("*, properties(label, city)")
      .eq("id", appointmentId)
      .single();
    if (apptErr || !appointment) {
      return new Response(JSON.stringify({ error: "Termin nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participantRows } = await adminClient
      .from("appointment_participants")
      .select("profile_id, profiles(first_name, last_name, email)")
      .eq("appointment_id", appointmentId);

    const participants = (participantRows || [])
      .map((r: any) => r.profiles)
      .filter((p: any) => p && p.email);

    if (!participants.length) {
      return new Response(JSON.stringify({ error: "Keine Teilnehmer mit E-Mail-Adresse gefunden." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (await outboundEmailsDisabled(adminClient)) {
      return suppressedEmailResponse({ skippedCount: participants.length });
    }

    const propertyLine = appointment.properties
      ? `<tr><td style="padding:2px 10px 2px 0;color:#555;">Objekt</td><td>${escapeHtml(appointment.properties.label)}${appointment.properties.city ? " (" + escapeHtml(appointment.properties.city) + ")" : ""}</td></tr>`
      : "";
    const noteLine = appointment.note
      ? `<p><strong>Notiz:</strong> ${escapeHtml(appointment.note)}</p>`
      : "";

    let sent = 0;
    const errors: string[] = [];

    for (const person of participants) {
      const others = participants
        .filter((p: any) => p.email !== person.email)
        .map((p: any) => `${p.first_name} ${p.last_name}`);
      const othersLine = others.length
        ? `<tr><td style="padding:2px 10px 2px 0;color:#555;">Weitere Teilnehmer</td><td>${escapeHtml(others.join(", "))}</td></tr>`
        : "";

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
          <h2 style="color:#1a2a40;">Terminanfrage</h2>
          <p>Guten Tag ${escapeHtml(person.first_name)},</p>
          <p>Sie wurden zu folgendem Termin eingeladen:</p>
          <table style="margin:12px 0;"><tbody>
            <tr><td style="padding:2px 10px 2px 0;color:#555;">Titel</td><td><strong>${escapeHtml(appointment.title)}</strong></td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#555;">Datum/Zeit</td><td>${fmtDateTime(appointment.starts_at)}</td></tr>
            ${propertyLine}
            ${othersLine}
          </tbody></table>
          ${noteLine}
          <p>Bitte loggen Sie sich im Vera Portal ein, um den Termin zu bestätigen.</p>
          <p style="margin-top:16px;">
            <a href="https://www.verahome.ch/portal/login.html" style="background:#1a2a40;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">
              Im Vera Portal anmelden
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
          subject: `Terminanfrage: ${appointment.title}`,
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
});
