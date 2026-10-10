/* Financial Home — Supabase connection settings.
   The publishable key is designed to ship in client code: every finance table is protected by
   row-level security (finance.is_member()). NEVER put a service_role / secret key here. */
'use strict';
(function (g) {
  g.SUPABASE_CONFIG = Object.freeze({
    url: 'https://kamzedvtaentmhpsrofa.supabase.co',
    publishableKey: 'sb_publishable_rgSx1diNp3Aq0pRKmxWlow_ujkiGyFL',
    schema: 'finance',
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
