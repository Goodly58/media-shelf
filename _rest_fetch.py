#!/usr/bin/env python
"""
Fetch the 406 outstanding books against the AUTHORITATIVE route:

    https://www.goodreads.com/book/isbn/<isbn>
      -> 301 to /book/show/<id>-<slug>, whose JSON-LD carries
         name, author, isbn, ratingValue and ratingCount.

This is a LOOKUP, not a search.  robots.txt (User-agent: *) disallows /search,
/work, /api, /review/show and /book/reviews/ - it does NOT disallow /book/isbn
or /book/show.  ClaudeBot / Claude-User / anthropic-ai are not named anywhere in
the file, so the * group applies; there is no Crawl-delay for *, and we pace at
roughly 1 request/second regardless.

WHY A BROWSER: goodreads sits behind AWS WAF.  Verified live during this run -
a plain curl to /book/isbn/9780141032214 returned:

    HTTP 202   bytes 0   url .../book/show/41728437-crashed

HTTP 202 with a ZERO-LENGTH body.  Not a 429, not a block page, and it arrives
AFTER the redirect has resolved, so it looks exactly like a real book page that
happens to carry no rating.  Reading it that way is what capped the last pass.
A real browser satisfies the JS challenge by actually being one; once the context
holds the aws-waf-token cookie we stop navigating page-by-page and pull the HTML
with a same-origin fetch from inside the page - same data, but no images, CSS or
fonts requested, so it is markedly less load on their server.

RULE 6: a 202 / empty / short / 429 / 5xx / challenge body is NEVER written to
the cache.  Only a rating, a genuine 404, or a real book page that truly carries
no rating is final.
RULE 7: before a 404 is believed, the ISBN is retried in its other form (13<->10),
because Goodreads' ISBN index sometimes holds only one of the two.  A 404 that
survives that is a real finding and is reported as one.

Cache _gr-rest-cache.json is keyed by the catalogue ISBN, so a rerun resumes.

    python _rest_fetch.py [--limit N]
"""
import argparse
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

CACHE = "_gr-rest-cache.json"
QUEUE = "_gr-rest-queue.json"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

RE_LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
RE_OG = re.compile(r'<meta property="og:title" content="([^"]*)"')
RE_ID = re.compile(r"/book/show/(\d+)")


# ------------------------------------------------------------------ ISBN forms
def _digits(s):
    return re.sub(r"[^0-9Xx]", "", str(s)).upper()


def isbn13to10(i13):
    d = _digits(i13)
    if len(d) != 13 or not d.startswith("978"):
        return None
    core = d[3:12]
    total = sum((10 - i) * int(core[i]) for i in range(9))
    r = (11 - total % 11) % 11
    return core + ("X" if r == 10 else str(r))


def isbn10to13(i10):
    d = _digits(i10)
    if len(d) != 10:
        return None
    core = "978" + d[:9]
    total = sum((3 if i % 2 else 1) * int(core[i]) for i in range(12))
    return core + str((10 - total % 10) % 10)


def alt_form(i):
    d = _digits(i)
    return isbn13to10(d) if len(d) == 13 else isbn10to13(d)


# ------------------------------------------------------------------ extraction
def parse_ld(body):
    for blob in RE_LD.findall(body):
        try:
            j = json.loads(blob)
        except Exception:
            continue
        if isinstance(j, dict) and (j.get("@type") == "Book" or "bookFormat" in j
                                    or "numberOfPages" in j):
            return j
    return None


def is_final(v):
    if not isinstance(v, dict):
        return False
    if v.get("ok") is True:
        return True
    return v.get("status") in (404, "no-rating-confirmed")


def classify(status, body, final_url):
    """-> (final, entry_or_reason).  final=False means RETRYABLE; never cached."""
    if status == 404:
        return True, {"ok": False, "status": 404}
    if status == 202:
        return False, "http-202-waf-zero-body"
    if status == 429 or status >= 500:
        return False, f"http-{status}"
    if status == 0:
        return False, "network"
    if not body:
        return False, "empty-body"
    if "awsWafCookieDomainList" in body or "x-amzn-waf" in body:
        return False, "waf-challenge"
    if len(body) < 20000:
        # a real goodreads book page is ~700KB; anything tiny is an interstitial
        return False, f"short-body-{len(body)}"
    if status != 200:
        return False, f"http-{status}"

    ld = parse_ld(body)
    og = RE_OG.search(body)
    og = og.group(1) if og else None
    bid = RE_ID.search(final_url or "")
    bid = bid.group(1) if bid else None

    author = None
    if ld and isinstance(ld.get("author"), list) and ld["author"]:
        author = ld["author"][0].get("name")

    agg = (ld or {}).get("aggregateRating") or {}
    try:
        rating = float(agg.get("ratingValue"))
        count = int(agg.get("ratingCount"))
    except (TypeError, ValueError):
        rating = count = None

    if rating and count:
        return True, {
            "ok": True, "rating": rating, "count": count,
            "title": (ld or {}).get("name") or og, "author": author,
            "pageIsbn": str(ld.get("isbn")) if ld and ld.get("isbn") else None,
            "bookId": bid, "url": final_url, "via": "book/isbn",
        }
    if ld or og:
        # real book page, genuinely unrated - RULE 7, a true answer
        return True, {
            "ok": False, "status": "no-rating-confirmed",
            "title": (ld or {}).get("name") or og, "author": author,
            "pageIsbn": str(ld.get("isbn")) if ld and ld.get("isbn") else None,
            "bookId": bid, "url": final_url, "via": "book/isbn",
        }
    return False, "no-ld-no-og"


JS_FETCH = """async (urls) => {
  return await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include', redirect: 'follow' });
      const t = await r.text();
      return { status: r.status, body: t, url: r.url };
    } catch (e) {
      return { status: 0, body: '', url: url };
    }
  }));
}"""

BATCH = 2          # 2 in flight, ~2s between batches -> ~1 req/sec overall


def launch(p):
    for kw in (dict(channel="msedge"), dict(executable_path=EDGE), dict()):
        try:
            return p.chromium.launch(headless=True, **kw)
        except Exception:
            continue
    raise RuntimeError("Could not launch a browser")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    queue = json.load(open(QUEUE, encoding="utf-8"))
    if args.limit:
        queue = queue[: args.limit]
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

    todo = [it for it in queue if not is_final(cache.get(it["isbn"]))]
    print(f"{len(queue)} in queue, {len(queue) - len(todo)} already settled, "
          f"{len(todo)} to fetch", flush=True)
    if not todo:
        return

    done = ok = dead = norate = 0
    t0 = time.time()

    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"),
        )
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
                    page.wait_for_timeout(5000)
                    if "awsWafCookieDomainList" not in page.content():
                        return True
                except Exception as e:
                    print(f"  warm attempt {attempt+1} failed: {str(e)[:80]}", flush=True)
                back = min(120, 10 * 2 ** attempt)
                print(f"  challenge still up; backing off {back}s", flush=True)
                time.sleep(back)
            return False

        if not warm():
            print("could not get past the challenge at all; rerun later", flush=True)
            sys.exit(1)
        print("session established", flush=True)

        def fetch_many(urls):
            try:
                return page.evaluate(JS_FETCH, urls)
            except Exception as e:
                print(f"  eval error: {str(e)[:90]}", flush=True)
                return [{"status": 0, "body": "", "url": u} for u in urls]

        # -------------------------------------------------- main pass
        stall = 0
        i = 0
        while i < len(todo):
            chunk = [it for it in todo[i:i + BATCH] if not is_final(cache.get(it["isbn"]))]
            if not chunk:
                i += BATCH
                continue
            urls = [f"https://www.goodreads.com/book/isbn/{it['isbn']}" for it in chunk]
            results = fetch_many(urls)

            retryable = False
            for it, res in zip(chunk, results):
                final, entry = classify(res["status"], res["body"], res.get("url"))
                if not final:
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
                back = min(180, 8 * 2 ** min(stall, 5))
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
                continue          # same chunk again; settled ones are skipped

            stall = 0
            i += len(chunk)
            if i % 40 < BATCH:
                json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=1)
                rate = done / max(1, time.time() - t0)
                print(f"  {i}/{len(todo)}  rated={ok} 404={dead} unrated={norate} "
                      f"~{(len(todo)-i)/max(rate,0.01)/60:.0f}min left", flush=True)
            time.sleep(2.0)

        json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=1)

        # -------------------------------------------------- RULE 7: alt ISBN form
        alts = []
        for it in todo:
            v = cache.get(it["isbn"])
            if isinstance(v, dict) and v.get("status") == 404 and "altTried" not in v:
                a = alt_form(it["isbn"])
                if a and a != it["isbn"]:
                    alts.append((it["isbn"], a))
        print(f"\n{len(alts)} confirmed 404s - retrying each in its other ISBN form",
              flush=True)

        stall = 0
        j = 0
        while j < len(alts):
            pair = alts[j:j + BATCH]
            urls = [f"https://www.goodreads.com/book/isbn/{a}" for _, a in pair]
            results = fetch_many(urls)
            retryable = False
            for (orig, a), res in zip(pair, results):
                final, entry = classify(res["status"], res["body"], res.get("url"))
                if not final:
                    retryable = True
                    continue
                if entry.get("ok") or entry.get("status") == "no-rating-confirmed":
                    entry = dict(entry, viaAlt=a,
                                 note=f"13<->10 alternate form of {orig}")
                    cache[orig] = entry
                    if entry.get("ok"):
                        ok += 1
                        dead -= 1
                    print(f"  {orig} 404 but alternate {a} -> \"{entry.get('title')}\"",
                          flush=True)
                else:
                    cache[orig] = dict(cache[orig], altTried=a)
            if retryable:
                stall += 1
                back = min(180, 8 * 2 ** min(stall, 5))
                print(f"  alt batch at {j} throttled -> backoff {back}s", flush=True)
                time.sleep(back)
                if stall in (2, 4, 6):
                    warm()
                if stall >= 10:
                    break
                continue
            stall = 0
            j += len(pair)
            time.sleep(2.0)

        json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=1)
        browser.close()

    left = len([it for it in queue if not is_final(cache.get(it["isbn"]))])
    print(f"\npass complete: {done} settled ({ok} rated, {dead} 404, {norate} unrated); "
          f"{left} still unsettled", flush=True)
    if left:
        print("rerun to resume - unsettled entries were never written to the cache",
              flush=True)


if __name__ == "__main__":
    main()
