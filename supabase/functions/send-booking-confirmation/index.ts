// supabase/functions/send-booking-confirmation/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-booking-confirmation" -> paste this file's contents
// -> Deploy. Reuses the same RESEND_API_KEY secret already set for
// send-invoice-email/send-booking-notification — no new secret needed.
//
// Triggered by the admin from the Vera Portal "Termine" calendar when
// confirming a pending ("angefragt") booking. Unlike
// send-booking-notification (called by anonymous visitors right after
// booking), this function acts on someone else's behalf by emailing
// the ORIGINAL requester — so, like send-invoice-email, it must verify
// the caller is actually an admin before doing anything.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
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
      .select("*, properties(label, city)")
      .eq("id", bookingId)
      .single();
    if (bookingErr || !booking) {
      return new Response(JSON.stringify({ error: "Buchung nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const propertyLine = booking.properties
      ? `<tr><td style="padding:2px 10px 2px 0;color:#555;">Objekt</td><td>${escapeHtml(booking.properties.label)}${booking.properties.city ? " (" + escapeHtml(booking.properties.city) + ")" : ""}</td></tr>`
      : "";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Ihr Termin ist bestätigt</h2>
        <p>Guten Tag ${escapeHtml(booking.name)},</p>
        <p>Wir freuen uns, Ihnen folgenden Termin zu bestätigen:</p>
        <table style="margin:12px 0;"><tbody>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Datum/Zeit</td><td><strong>${fmtDateTime(booking.starts_at)}</strong></td></tr>
          ${propertyLine}
        </tbody></table>
        <p>Bei Fragen oder falls sich der Termin bei Ihnen ändern sollte, melden Sie sich gerne jederzeit bei uns.</p>
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
        subject: "Ihr Termin ist bestätigt",
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
