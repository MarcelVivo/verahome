// supabase/functions/send-booking-notification/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-booking-notification" -> paste this file's contents
// -> Deploy. Reuses the same RESEND_API_KEY secret already set for
// send-invoice-email — no new secret needed.
//
// Unlike send-invoice-email, this function needs NO caller-identity
// check: it's called by anonymous website visitors right after a
// successful public booking (create_booking() RPC already validated
// everything server-side). The function only ever reads an EXISTING
// booking by id and emails the fixed business address — it never lets
// the caller choose a recipient or inject arbitrary content beyond
// what's already stored in the (already-validated) booking row.

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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Neue Terminbuchung</h2>
        <p><strong>${escapeHtml(booking.name)}</strong> hat über die Website einen Termin gebucht.</p>
        <table style="margin:12px 0;"><tbody>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Objekt</td><td>${booking.properties ? escapeHtml(booking.properties.label) + (booking.properties.city ? " (" + escapeHtml(booking.properties.city) + ")" : "") : "Allgemeines Anliegen"}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Datum/Zeit</td><td>${new Date(booking.starts_at).toLocaleString("de-CH")}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">E-Mail</td><td>${escapeHtml(booking.email)}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Telefon</td><td>${escapeHtml(booking.phone || "–")}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Nachricht</td><td>${escapeHtml(booking.message || "–")}</td></tr>
        </tbody></table>
      </div>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Vera Home Immobilien <rechnungen@verahome.ch>",
        to: ["welcome@verahome.ch"],
        subject: `Neue Terminbuchung: ${booking.name}`,
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
