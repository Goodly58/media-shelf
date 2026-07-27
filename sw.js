/* Shelf service worker — root shim.
   The real worker lives in assets/sw.js, but a worker can only control URLs
   under its own directory unless the host sends a Service-Worker-Allowed
   header, which GitHub Pages cannot do. Registering this one-line file from the
   site root gives the worker whole-site scope.
   The ?v= query is forwarded so the imported script is re-fetched (and its
   cache renamed) whenever pwa.js bumps SW_VERSION. */
/* BUILD_STAMP: 08619958c3
   Browsers revalidate the REGISTERED worker script on navigation, but they only
   re-install when its bytes differ. This shim was previously byte-identical on
   every deploy, so a client that had cached an old build could never be told
   about a new one. The stamp below is rewritten by build-version.js each build,
   which guarantees a re-install and a fresh precache. Do not hand-edit it. */
importScripts('assets/sw.js' + (self.location.search || ''));
