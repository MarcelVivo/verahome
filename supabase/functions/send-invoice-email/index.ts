// supabase/functions/send-invoice-email/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "send-invoice-email" -> paste this file's contents ->
// Deploy. No local CLI/terminal needed.
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY   <- the client's Resend API key. This is the ONLY
//                       secret to set manually — SUPABASE_URL,
//                       SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
//                       are injected automatically into every function
//                       and must NOT be set again here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORY_TEXT: Record<string, string> = {
  miete: "Miete",
  nebenkosten: "Nebenkosten",
  schaden_reparatur: "Schaden-Reparatur",
  handwerkerrechnung: "Handwerkerrechnung",
  amtsrechnung: "Amtsrechnung",
  eigentuemerabrechnung: "Eigentümerabrechnung",
  sonstiges: "Sonstiges",
};

function fmtCHF(n: number): string {
  return "CHF " + Number(n || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("de-CH") : "–";
}

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
    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId fehlt." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    // Two clients, deliberately:
    //  - callerClient runs AS the calling user (forwards their own JWT)
    //    and is ONLY used to find out who is calling (auth.getUser()) —
    //    it never touches invoices/profiles, so it can't leak anything
    //    the caller couldn't already read themselves.
    //  - adminClient uses the service-role key and deliberately bypasses
    //    RLS, because this function's whole job is reading a
    //    recipient's email on their behalf — something the caller's own
    //    RLS-scoped session could never legitimately do for someone
    //    else's profile row.
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
    const callerId = callerData.user.id;

    const { data: invoice, error: invoiceErr } = await adminClient
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invoiceErr || !invoice) {
      return new Response(JSON.stringify({ error: "Rechnung nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: only the invoice's own issuer, or an admin, may
    // trigger its email — mirrors enforce_invoice_rules()/mark_invoice_paid()
    // re-checking ownership server-side rather than trusting RLS/UI alone,
    // which matters here BECAUSE adminClient bypasses RLS entirely.
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("id, category")
      .eq("id", callerId)
      .single();

    const isAuthorized = callerProfile?.category === "admin" || invoice.issuer_profile_id === callerId;
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Keine Berechtigung für diese Rechnung." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: lineItems }, { data: issuer }, { data: recipient }] = await Promise.all([
      adminClient.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).order("sort_order"),
      adminClient.from("profiles").select("*").eq("id", invoice.issuer_profile_id).single(),
      adminClient.from("profiles").select("*").eq("id", invoice.recipient_profile_id).single(),
    ]);

    if (!recipient?.email) {
      return new Response(JSON.stringify({ error: "Empfänger hat keine E-Mail-Adresse hinterlegt." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const issuerLabel =
      issuer && issuer.category !== "admin" ? `${issuer.last_name} ${issuer.first_name}` : "Vera Home Immobilien";
    const categoryLabel = CATEGORY_TEXT[invoice.category] || invoice.category;
    const detailUrl = `https://www.verahome.ch/portal/invoice-detail.html?id=${invoice.id}`;

    const rowsHtml = (lineItems || [])
      .map(
        (li: any) =>
          `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${escapeHtml(li.description)}</td>` +
          `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${li.quantity}</td>` +
          `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmtCHF(li.unit_price)}</td>` +
          `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmtCHF(li.line_total)}</td></tr>`
      )
      .join("");

    const paymentInfoHtml = issuer?.iban
      ? `<p style="margin:16px 0 4px;"><strong>Zahlungsinformationen</strong><br>` +
        `IBAN: ${escapeHtml(issuer.iban)}<br>` +
        (issuer.bank_name ? `Bank: ${escapeHtml(issuer.bank_name)}<br>` : "") +
        (issuer.bank_account_holder ? `Kontoinhaber: ${escapeHtml(issuer.bank_account_holder)}<br>` : "") +
        `</p>`
      : "";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;">
        <h2 style="color:#1a2a40;">Neue Rechnung ${escapeHtml(invoice.invoice_number)}</h2>
        <p>Guten Tag ${escapeHtml(recipient.first_name)},</p>
        <p>${escapeHtml(issuerLabel)} hat Ihnen soeben eine neue Rechnung über das Vera Portal gestellt.</p>
        <table style="margin:12px 0;"><tbody>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Kategorie</td><td>${escapeHtml(categoryLabel)}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Fällig bis</td><td>${fmtDate(invoice.due_date)}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#555;">Total</td><td><strong>${fmtCHF(invoice.total)}</strong></td></tr>
        </tbody></table>
        <table style="border-collapse:collapse;width:100%;">
          <thead><tr style="background:#f2f2f2;">
            <th style="padding:6px 10px;text-align:left;">Beschreibung</th>
            <th style="padding:6px 10px;text-align:right;">Menge</th>
            <th style="padding:6px 10px;text-align:right;">Einzelpreis</th>
            <th style="padding:6px 10px;text-align:right;">Total</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${paymentInfoHtml}
        <p style="margin-top:20px;">
          <a href="${detailUrl}" style="background:#1a2a40;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">
            Rechnung im Vera Portal ansehen
          </a>
        </p>
        <p style="color:#777;font-size:12px;margin-top:24px;">
          Diese E-Mail wurde automatisch vom Vera Portal versendet. Bei Fragen wenden Sie sich bitte direkt
          an Vera Home Immobilien.
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
        to: [recipient.email],
        subject: `Neue Rechnung ${invoice.invoice_number} — ${categoryLabel}`,
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
