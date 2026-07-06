// supabase/functions/admin-delete-user/index.ts
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function
// -> name it "admin-delete-user" -> paste this file's contents ->
// Deploy. Reuses the existing SUPABASE_SERVICE_ROLE_KEY — no new
// secret needed.
//
// Triggered by the "Löschen" button in the Kontakt detail modal.
// Deleting another user's auth.users row requires the service role
// (a normal client can never do this), which is why this needs to be
// an edge function rather than a plain client-side delete. Deleting
// auth.users cascades to public.profiles (profiles.id references
// auth.users(id) on delete cascade), which in turn cascades to every
// table that references a profile (tenancies, ownerships, documents,
// messages, invoices, etc.) — this is real, irreversible account
// deletion, not a soft delete.
//
// Refuses to delete an admin account — that must stay a manual
// Supabase action, matching the existing "admin category changes
// happen manually" convention this project already follows elsewhere.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { profileId } = await req.json();
    if (!profileId) {
      return new Response(JSON.stringify({ error: "profileId fehlt." }), {
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

    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("category")
      .eq("id", profileId)
      .single();
    if (!targetProfile) {
      return new Response(JSON.stringify({ error: "Kontakt nicht gefunden." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetProfile.category === "admin") {
      return new Response(JSON.stringify({ error: "Admin-Konten können hier nicht gelöscht werden." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(profileId);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
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
