// supabase/functions/send-booking-reschedule/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-booking-reschedule" -> paste this file's contents
// -> Deploy. Reuses the same RESEND_API_KEY secret already set for the
// other booking/invoice email functions — no new secret needed.
//
// Triggered by the admin from the Vera Portal "Termine" calendar when
// a booked slot no longer works and needs to be freed up. The client
// is expected to have already set the booking's status to 'storniert'
// (freeing the slot for get_available_slots()) before calling this —
// this function only sends the "please pick a new time" email, it
// does not touch the booking row itself. Like send-booking-confirmation,
// the caller must be verified as admin since this emails someone else
// on the admin's behalf.

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
    const { bookingId, message } = await req.json();
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId fehlt." }), {
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

    const { data: booking, error: bookingErr } = await adminClient
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    if (bookingErr || !booking) {
      return new Response(JSON.stringify({ error: "Buchung nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (await outboundEmailsDisabled(adminClient)) {
      return suppressedEmailResponse({ bookingId });
    }

    const messageHtml = message
      ? `<p>${escapeHtml(message)}</p>`
      : "";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Ihr Termin muss leider verschoben werden</h2>
        <p>Guten Tag ${escapeHtml(booking.name)},</p>
        <p>Ihr bisheriger Termin am <strong>${fmtDateTime(booking.starts_at)}</strong> kann leider nicht wie geplant stattfinden.</p>
        ${messageHtml}
        <p>Bitte buchen Sie ganz einfach einen neuen Termin über unsere Website:</p>
        <p style="margin-top:16px;">
          <a href="https://www.verahome.ch/index.html#mietertools" style="background:#1a2a40;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">
            Neuen Termin buchen
          </a>
        </p>
        <p>Wir entschuldigen uns für die Unannehmlichkeiten und freuen uns auf Sie.</p>
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
        to: [booking.email],
        subject: "Ihr Termin muss leider verschoben werden",
        html,
      }),
    });

    const resendBody = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "Resend-Fehler", detail: resendBody }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: resendBody.id }), {
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
