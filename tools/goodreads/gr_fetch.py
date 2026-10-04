#!/usr/bin/env python
"""
Goodreads rating sweep via a real browser (headless Edge / Playwright).

WHY A BROWSER: goodreads sits behind AWS WAF. After ~500 plain fetches it answers
HTTP 202 with a 2.4 KB body and header `x-amzn-waf-action: challenge`. That is a
JS "are you a real browser" gate; waiting does NOT clear it (verified: still 202
after a 60s wait). A real browser satisfies it by actually being one. We do not
forge the token, rotate IPs, or spoof fingerprints.

Once the context holds the aws-waf-token cookie we stop navigating page-by-page
and pull the HTML with a same-origin fetch from inside the page: same data, but
no images/CSS/fonts fetched, so it is markedly less load on their server.

RULE 5: a challenge/202/5xx/empty body is NEVER written to the cache. Only a real
answer is final: a rating, a genuine 404, or a real book page that truly carries
no rating.

  python tools/goodreads/gr_fetch.py [--limit N]
"""
import argparse
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

CACHE = "_goodreads-cache.json"
QUEUE = "_gr_queue.json"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

RE_RATING = re.compile(r'"ratingValue":\s*"?([0-9.]+)"?')
RE_COUNT = re.compile(r'"ratingCount":\s*"?([0-9]+)"?')
RE_OG = re.compile(r'<meta property="og:title" content="([^"]*)"')


def launch(p):
    for kw in (dict(channel="msedge"), dict(executable_path=EDGE), dict()):
        try:
            return p.chromium.launch(headless=True, **kw)
        except Exception:
            continue
    raise RuntimeError("Could not launch a browser")


def is_final(v):
    """Mirror of tools/goodreads/gr_lib.mjs isFinal: only a real answer counts as settled."""
    if not isinstance(v, dict):
        return False
    if v.get("ok") is True:
        return True
    return v.get("status") in (404, "no-rating-confirmed")


def classify(status, body):
    """-> (final, entry). final=False means retryable; never cache it."""
    if status == 404:
        return True, {"ok": False, "status": 404}
    if status == 202 or "awsWafCookieDomainList" in body or "x-amzn-waf" in body:
        return False, {"retry": "waf-challenge"}
    if status >= 500 or status == 429:
        return False, {"retry": f"http-{status}"}
    if body is None or len(body) < 20000:
        # a real goodreads book page is ~700KB+; anything tiny is an interstitial
        return False, {"retry": f"short-body-{0 if not body else len(body)}"}
    m = RE_RATING.search(body)
    og = RE_OG.search(body)
    if m:
        c = RE_COUNT.search(body)
        return True, {
            "ok": True,
            "rating": float(m.group(1)),
            "count": int(c.group(1)) if c else None,
            "title": og.group(1) if og else None,
        }
    if og:
        # real page, genuinely unrated. That is a true answer, not a failure.
        return True, {"ok": False, "status": "no-rating-confirmed", "title": og.group(1)}
    return False, {"retry": "no-og-no-rating"}


JS_FETCH = """async (urls) => {
  return await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include', redirect: 'follow' });
      const t = await r.text();
      return { status: r.status, body: t };
    } catch (e) {
      return { status: 0, body: '' };
    }
  }));
}"""

# 3 in flight, ~2s between batches -> roughly one request per 1.8s across the
# whole run, comfortably inside the ~1 req/sec budget while cutting wall time.
BATCH = 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    queue = json.load(open(QUEUE, encoding="utf-8"))
    if args.limit:
        queue = queue[: args.limit]
    cache = json.load(open(CACHE, encoding="utf-8"))

    done = ok = dead = norate = 0
    t0 = time.time()

    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"),
        )
        # don't pull images/fonts/media we don't need
        ctx.route(re.compile(r"\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4|css)($|\?)"),
                  lambda route: route.abort())
        page = ctx.new_page()

        def warm():
            """Navigate for real so the WAF challenge runs and mints a cookie."""
            for attempt in range(6):
                try:
                    page.goto("https://www.goodreads.com/book/isbn/9780441013593",
                              wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(4000)
                    if "awsWafCookieDomainList" not in page.content():
                        return True
                    page.wait_for_timeout(4000)   # challenge script is running
                    if "awsWafCookieDomainList" not in page.content():
                        return True
                except Exception as e:
                    print(f"  warm attempt {attempt+1} failed: {e}", flush=True)
                back = min(120, 10 * (2 ** attempt))
                print(f"  challenge still up; backing off {back}s", flush=True)
                time.sleep(back)
            return False

        if not warm():
            print("could not get past the challenge at all", flush=True)
            sys.exit(1)
        print("session established", flush=True)

        stall = 0
        i = 0
        while i < len(queue):
            window = queue[i:i + BATCH]
            # already-resolved entries (e.g. from a partly-successful retried batch)
            # must not be fetched again
            chunk = [it for it in window if not is_final(cache.get(it["isbn"]))]
            if not chunk:
                i += len(window)
                continue
            urls = [f"https://www.goodreads.com/book/isbn/{it['isbn']}" for it in chunk]
            try:
                results = page.evaluate(JS_FETCH, urls)
            except Exception as e:
                print(f"  eval error: {str(e)[:90]}", flush=True)
                results = [{"status": 0, "body": ""} for _ in chunk]

            retryable = False
            for it, res in zip(chunk, results):
                final, entry = classify(res["status"], res["body"])
                if not final:
                    # RULE 5: retryable. Do not write anything to the cache.
                    retryable = True
                    continue
                cache[it["isbn"]] = entry
                done += 1
                if entry.get("ok"):
                    ok += 1
                elif entry.get("status") == 404:
                    dead += 1
                else:
                    norate += 1

            if retryable:
                stall += 1
                back = min(180, 8 * (2 ** min(stall, 5)))
                print(f"  batch at {i} throttled -> backoff {back}s (stall {stall})", flush=True)
                time.sleep(back)
                if stall in (2, 4, 6, 8):
                    print("  re-warming session", flush=True)
                    try:
                        ctx.clear_cookies()
                    except Exception:
                        pass
                    warm()
                if stall >= 10:
                    print("  giving up this pass; rerun to resume", flush=True)
                    break
                continue    # same chunk again; resolved ones are already cached
                            # and will be skipped on the next pass via the queue

            stall = 0
            i += len(chunk)

            if i % 30 < BATCH:
                json.dump(cache, open(CACHE, "w", encoding="utf-8"))
                rate = done / max(1, time.time() - t0)
                left = (len(queue) - i) / max(rate, 0.01) / 60
                print(f"  {i}/{len(queue)}  ok={ok} 404={dead} unrated={norate} "
                      f"~{left:.0f}min left", flush=True)

            time.sleep(2.0)

        json.dump(cache, open(CACHE, "w", encoding="utf-8"))
        browser.close()

    print(f"\npass complete: {done} resolved ({ok} rated, {dead} 404, {norate} unrated)", flush=True)


if __name__ == "__main__":
    main()
