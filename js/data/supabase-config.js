/* Financial Home — Supabase connection settings (dedicated "finance" project, schema public).
   The publishable key is injected at deploy time from the repository secret SUPABASE_PUBLISHABLE_KEY
   (.github/workflows/pages.yml), so no key is kept in this repository. It is a browser key by design: every table
   is protected by row-level security (public.is_member()). NEVER put a service_role / secret key here. */
'use strict';
(function (g) {
  g.SUPABASE_CONFIG = Object.freeze({
    url: 'https://lqxjjickxevmowzxzcky.supabase.co',
    publishableKey: '__SUPABASE_PUBLISHABLE_KEY__',
    schema: 'public',
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
