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
// already with status 'active' (portal access is technically allowed
// after password setup) and the correct member_number for the chosen
// category. portal_invited_at / portal_registered_at track whether the
// invited contact has actually completed the password setup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_CATEGORIES = ["mieter", "eigentuemer", "partner", "handwerker", "hauswart", "firma", "aemter", "admin"];

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

function randomTemporaryPassword(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}-Aa1!`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      email,
      email2,
      email3,
      first_name,
      last_name,
      categories,
      phone,
      phone2,
      phone3,
      company_name,
      address_type,
      address_street,
      address_zip,
      address_city,
      address2_type,
      address2_street,
      address2_zip,
      address2_city,
      address3_type,
      address3_street,
      address3_zip,
      address3_city,
    } = await req.json();
    const categoryList: string[] = Array.isArray(categories) ? categories.filter((c) => VALID_CATEGORIES.includes(c)) : [];
    if (!email || !first_name || !last_name || categoryList.length === 0) {
      return new Response(JSON.stringify({ error: "E-Mail, Vor-/Nachname und mindestens eine gültige Kategorie sind erforderlich." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const category = categoryList[0]; // primaere Kategorie: Mitgliedsnummer-Praefix, is_admin()-Check

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
      .select("category, email")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfile?.category !== "admin") {
      return new Response(JSON.stringify({ error: "Keine Berechtigung." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Nur der Owner-Admin darf weitere Admin-Konten anlegen -- die
    // Kontakt-Maske im Portal bietet "admin" als Kategorie ohnehin nicht
    // an, aber ohne diesen Check koennte ein direkter API-Aufruf von
    // JEDEM Admin-Konto aus ein weiteres Vollzugriffs-Admin-Konto
    // erzeugen. Gleiches hardcodiertes Owner-Muster wie
    // protect_owner_admin_profile()/archive_profile() in
    // soft-delete-core-records.sql.
    const OWNER_ADMIN_EMAIL = "kontakt@marcelspahr.ch";
    if (categoryList.includes("admin") && String(callerProfile?.email ?? "").toLowerCase() !== OWNER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Nur der Owner-Admin darf weitere Admin-Konten anlegen." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMetadata = {
      category,
      first_name,
      last_name,
      email2: email2 || null,
      email3: email3 || null,
      phone: phone || null,
      phone2: phone2 || null,
      phone3: phone3 || null,
      company_name: company_name || null,
      address_type: address_type || null,
      address_street: address_street || null,
      address_zip: address_zip || null,
      address_city: address_city || null,
      address2_type: address2_type || null,
      address2_street: address2_street || null,
      address2_zip: address2_zip || null,
      address2_city: address2_city || null,
      address3_type: address3_type || null,
      address3_street: address3_street || null,
      address3_zip: address3_zip || null,
      address3_city: address3_city || null,
    };

    const emailsDisabled = await outboundEmailsDisabled(adminClient);
    const { data: invited, error: inviteErr } = emailsDisabled
      ? await adminClient.auth.admin.createUser({
          email,
          password: randomTemporaryPassword(),
          email_confirm: true,
          user_metadata: userMetadata,
        })
      : await adminClient.auth.admin.inviteUserByEmail(email, {
          data: userMetadata,
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

    if (category === "admin") {
      const { error: adminUpdateErr } = await adminClient
        .from("profiles")
        .update({
          category: "admin",
          member_number: null,
          status: "active",
          is_primary_admin: false,
        })
        .eq("id", invited.user.id);
      if (adminUpdateErr) {
        return new Response(JSON.stringify({ error: adminUpdateErr.message }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!emailsDisabled) {
      const { error: registrationMarkErr } = await adminClient
        .from("profiles")
        .update({
          portal_invited_at: new Date().toISOString(),
          portal_registered_at: null,
        })
        .eq("id", invited.user.id);
      if (registrationMarkErr) {
        console.error("registration status update failed:", registrationMarkErr.message);
      }
    }

    // handle_new_user() legt den profiles-Datensatz an; alle Rollen
    // landen zusaetzlich hier. Admin-Rollen werden nicht in die
    // Kontakt-Rollen-Tabelle geschrieben, weil voller Portalzugriff
    // ueber profiles.category = 'admin' gesteuert wird.
    const roleRows = categoryList
      .filter((c) => c !== "admin")
      .map((c) => ({ profile_id: invited.user.id, category: c }));
    const { error: rolesErr } = roleRows.length
      ? await adminClient.from("profile_role_assignments").insert(roleRows)
      : { error: null };
    if (rolesErr) {
      console.error("profile_role_assignments insert failed:", rolesErr.message);
    }

    return new Response(JSON.stringify({ ok: true, profileId: invited.user.id, skipped: emailsDisabled }), {
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
