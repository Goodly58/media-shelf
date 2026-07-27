/* Shelf service worker — root shim.
   The real worker lives in assets/sw.js, but a worker can only control URLs
   under its own directory unless the host sends a Service-Worker-Allowed
   header, which GitHub Pages cannot do. Registering this one-line file from the
   site root gives the worker whole-site scope.
   The ?v= query is forwarded so the imported script is re-fetched (and its
   cache renamed) whenever pwa.js bumps SW_VERSION. */
importScripts('assets/sw.js' + (self.location.search || ''));
