/* Vera Portal — shared Supabase auth helpers.
   Load order on every portal page:
   1) https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
   2) /public/js/supabase-config.js
   3) /public/js/portal-auth.js  (this file)
*/
window.VeraPortal = (function () {
  "use strict";

  var client = null;
  function getClient() {
    if (!client) {
      client = window.supabase.createClient(
        window.VERA_SUPABASE_CONFIG.url,
        window.VERA_SUPABASE_CONFIG.anonKey
      );
    }
    return client;
  }

  /* category must be one of: mieter | eigentuemer | partner | handwerker
     ('admin' is never self-assignable — the server-side trigger clamps
     any other value to 'mieter' regardless of what's sent here). */
  function signUp(fields) {
    return getClient().auth.signUp({
      email: fields.email,
      password: fields.password,
      options: {
        data: {
          first_name: fields.firstName,
          last_name: fields.lastName,
          phone: fields.phone || null,
          category: fields.category,
          address_street: fields.addressStreet || null,
          address_zip: fields.addressZip || null,
          address_city: fields.addressCity || null
        }
      }
    });
  }

  function signIn(fields) {
    return getClient().auth.signInWithPassword({
      email: fields.email,
      password: fields.password
    });
  }

  function signOut() {
    return getClient().auth.signOut();
  }

  async function getSession() {
    var res = await getClient().auth.getSession();
    return res.data.session; // null if not logged in
  }

  /* Fetches the current user's own profiles row (member number, category,
     status, contact fields). Returns null if not logged in. */
  async function getProfile() {
    var session = await getSession();
    if (!session) return null;
    var res = await getClient()
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (res.error) throw res.error;
    return res.data;
  }

  /* Call at the top of any protected page. Redirects to login.html if
     there's no session; resolves with the session otherwise. */
  async function requireAuth(opts) {
    opts = opts || {};
    var session = await getSession();
    if (!session) {
      window.location.href = opts.redirectTo || "/portal/login.html";
      return null;
    }
    return session;
  }

  /* Call at the top of any admin-only page. Redirects to login.html if
     there's no session at all, or to dashboard.html if logged in but
     not an admin. Resolves with {session, profile} on success. This is
     a UX/defense-in-depth layer on top of RLS, not a substitute for it —
     the database enforces the real access control either way. */
  async function requireAdmin(opts) {
    opts = opts || {};
    var session = await requireAuth(opts);
    if (!session) return null;
    var profile = await getProfile();
    if (!profile || profile.category !== "admin") {
      window.location.href = opts.redirectTo || "/portal/dashboard.html";
      return null;
    }
    return { session: session, profile: profile };
  }

  /* Marks a pending sign/fill document as completed. fillContent is
     only meaningful for action_type='fill' documents — omit/null for
     'sign'. Wraps the complete_document() RPC. */
  function completeDocument(documentId, fillContent) {
    return getClient().rpc("complete_document", {
      p_document_id: documentId,
      p_fill_content: fillContent || null
    });
  }

  /* Returns the single Admin's profile id, or null if none is set up
     yet. Never exposes any other admin profile field to the client —
     needed because a regular user's own profiles SELECT policy only
     ever matches their own row, not Julia's. */
  async function getAdminId() {
    var res = await getClient().rpc("get_admin_id");
    if (res.error) throw res.error;
    return res.data;
  }

  /* Marks a message the current user received as read. Wraps the
     mark_message_read() RPC. */
  function markMessageRead(messageId) {
    return getClient().rpc("mark_message_read", { p_message_id: messageId });
  }

  function requestPasswordReset(email) {
    return getClient().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/portal/update-password.html"
    });
  }

  function updatePassword(newPassword) {
    return getClient().auth.updateUser({ password: newPassword });
  }

  /* Marks an invoice as paid. Wraps the mark_invoice_paid() RPC — only
     the issuer or admin can succeed (enforced server-side), never the
     recipient. */
  function markInvoicePaid(invoiceId) {
    return getClient().rpc("mark_invoice_paid", { p_invoice_id: invoiceId });
  }

  /* Triggers the "you have a new invoice" notification email for one
     invoice via the send-invoice-email Edge Function. Callers should
     treat a rejected/failed result as non-fatal — the invoice's own
     status change or creation is already the source of truth; the email
     is a courtesy notification on top of it, never something to roll
     back for. */
  function sendInvoiceEmail(invoiceId) {
    return getClient().functions.invoke("send-invoice-email", {
      body: { invoiceId: invoiceId }
    });
  }

  /* Generates + immediately sends ("offen") this month's occurrence of a
     Dauerauftrag template. Wraps generate_recurring_invoice_occurrence(). */
  function generateRecurringInvoiceOccurrence(recurringInvoiceId) {
    return getClient().rpc("generate_recurring_invoice_occurrence", {
      p_recurring_invoice_id: recurringInvoiceId
    });
  }

  return {
    getClient: getClient,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    getProfile: getProfile,
    requireAuth: requireAuth,
    requireAdmin: requireAdmin,
    completeDocument: completeDocument,
    getAdminId: getAdminId,
    markMessageRead: markMessageRead,
    markInvoicePaid: markInvoicePaid,
    sendInvoiceEmail: sendInvoiceEmail,
    generateRecurringInvoiceOccurrence: generateRecurringInvoiceOccurrence,
    requestPasswordReset: requestPasswordReset,
    updatePassword: updatePassword
  };
})();
