// supabase/functions/admin-create-user/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "admin-create-user" -> paste this file's contents ->
// Deploy. Reuses the existing SUPABASE_SERVICE_ROLE_KEY — no new
// secret needed.
//
// Triggered by the admin's "+" button on the Kontakte page. There is
// no insert policy on public.profiles — rows are only ever created by
// the handle_new_user() trigger firing on an auth.users insert — so
// creating a contact directly from the client is not possible. This
// function uses inviteUserByEmail() (service role only) to create the
// auth.users row and send Supabase's own invite/set-password email;
// the existing trigger then creates the matching profiles row from
// the metadata we pass in, exactly like a self-registration would,
// already with status 'active' (see handle_new_user()'s hardcoded
// value) and the correct member_number for the chosen category.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_CATEGORIES = ["mieter", "eigentuemer", "partner", "handwerker", "hauswart", "firma", "aemter"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, first_name, last_name, category, phone, address_street, address_zip, address_city } = await req.json();
    if (!email || !first_name || !last_name || !VALID_CATEGORIES.includes(category)) {
      return new Response(JSON.stringify({ error: "E-Mail, Vor-/Nachname und eine gültige Kategorie sind erforderlich." }), {
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

    const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        category,
        first_name,
        last_name,
        phone: phone || null,
        address_street: address_street || null,
        address_zip: address_zip || null,
        address_city: address_city || null,
      },
      // update-password.html, nicht login.html: der Einladungs-Link
      // liefert per Hash-Fragment ein access_token, aus dem
      // supabase-js (detectSessionInUrl, Standardverhalten) automatisch
      // eine Session herstellt -- der neue Kontakt hat noch kein
      // Passwort und kann sich daher nicht einloggen, sondern muss
      // erst eines setzen (exakt der gleiche Ablauf wie beim
      // "Passwort vergessen"-Link, siehe resetPasswordForEmail in
      // portal-auth.js).
      redirectTo: "https://www.verahome.ch/portal/update-password.html",
    });

    if (inviteErr || !invited?.user) {
      return new Response(JSON.stringify({ error: inviteErr?.message || "Einladung fehlgeschlagen." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, profileId: invited.user.id }), {
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
