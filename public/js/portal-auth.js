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

  /* Returns the primary Admin's profile id, or null if none is set up
     yet. Never exposes any other admin profile field to the client —
     needed because a regular user's own profiles SELECT policy only
     ever matches their own row, not Vera Home's primary admin row. */
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

  /* Zwei-Faktor-Authentifizierung (TOTP) — optionale, pro Nutzer
     einrichtbare Absicherung des Logins. Enrollment/Verifizierung laeuft
     komplett ueber die eingebaute Supabase-Auth-MFA-API, keine eigene
     Tabelle noetig. */
  function mfaEnroll() {
    return getClient().auth.mfa.enroll({ factorType: "totp" });
  }

  async function mfaListFactors() {
    var res = await getClient().auth.mfa.listFactors();
    if (res.error) throw res.error;
    return res.data.totp || [];
  }

  function mfaUnenroll(factorId) {
    return getClient().auth.mfa.unenroll({ factorId: factorId });
  }

  function mfaChallengeAndVerify(factorId, code) {
    return getClient().auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
  }

  async function mfaGetAssuranceLevel() {
    var res = await getClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (res.error) throw res.error;
    return res.data; // { currentLevel, nextLevel }
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

  /* Sends a payment-reminder email for an overdue invoice via the same
     send-invoice-email Edge Function, just with reminder:true — the
     function re-validates server-side that the invoice is still
     'offen' before sending, never trusting the client's own overdue
     computation. */
  function sendPaymentReminder(invoiceId) {
    return getClient().functions.invoke("send-invoice-email", {
      body: { invoiceId: invoiceId, reminder: true }
    });
  }

  /* Generates + immediately sends ("offen") this month's occurrence of a
     Dauerauftrag template. Wraps generate_recurring_invoice_occurrence(). */
  function generateRecurringInvoiceOccurrence(recurringInvoiceId) {
    return getClient().rpc("generate_recurring_invoice_occurrence", {
      p_recurring_invoice_id: recurringInvoiceId
    });
  }

  /* Fetches the current user's unread sidebar-badge counts for all
     tracked sections in one round-trip. Wraps get_unread_counts().
     Returns a plain object keyed by section, e.g.
     { messages: 2, invoices: 0, meldungen: 1, documents: 0,
       calendar: 0, waschplan: 0 }. */
  async function getUnreadCounts() {
    var res = await getClient().rpc("get_unread_counts");
    if (res.error) throw res.error;
    var counts = {};
    (res.data || []).forEach(function (row) {
      counts[row.section] = row.unread_count;
    });
    return counts;
  }

  /* Marks one sidebar section as "seen" for the current user, clearing
     its badge. Wraps mark_section_seen(). Not valid for 'messages' —
     that section clears itself via markMessageRead() instead. */
  function markSectionSeen(section) {
    return getClient().rpc("mark_section_seen", { p_section: section });
  }

  return {
    getClient: getClient,
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
    sendPaymentReminder: sendPaymentReminder,
    generateRecurringInvoiceOccurrence: generateRecurringInvoiceOccurrence,
    getUnreadCounts: getUnreadCounts,
    markSectionSeen: markSectionSeen,
    requestPasswordReset: requestPasswordReset,
    updatePassword: updatePassword,
    mfaEnroll: mfaEnroll,
    mfaListFactors: mfaListFactors,
    mfaUnenroll: mfaUnenroll,
    mfaChallengeAndVerify: mfaChallengeAndVerify,
    mfaGetAssuranceLevel: mfaGetAssuranceLevel
  };
})();
