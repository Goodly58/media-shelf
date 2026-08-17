#!/usr/bin/env python
"""
Independent re-read of a random sample of the findings, in a FRESH browser
session, to confirm they reproduce and are not an artifact of the cached pass.
RULE: report before you write - and check the report before reporting it.

    python _rest_spotcheck.py [--n 12]
"""
import argparse
import json
import random
import re
import time

from playwright.sync_api import sync_playwright

from _rest_fetch import JS_FETCH, classify, launch

random.seed(20260818)

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=12)
args = ap.parse_args()

rows = json.load(open("_books-rest.json", encoding="utf-8"))
pool = {
    "isbn-names-a-different-book": [],
    "isbn-same-author-needs-review": [],
    "isbn-404": [],
    "confirmed": [],
}
for r in rows:
    if r["status"] in pool:
        pool[r["status"]].append(r)

sample = []
for st, lst in pool.items():
    k = max(2, args.n // len(pool))
    sample += random.sample(lst, min(k, len(lst)))

print(f"re-reading {len(sample)} rows in a fresh session\n", flush=True)

agree = disagree = unsettled = 0
with sync_playwright() as p:
    browser = launch(p)
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"))
    ctx.route(re.compile(r"\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4|css)($|\?)"),
              lambda route: route.abort())
    page = ctx.new_page()
    for attempt in range(6):
        page.goto("https://www.goodreads.com/book/isbn/9780441013593",
                  wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        if "awsWafCookieDomainList" not in page.content():
            break
        time.sleep(min(120, 10 * 2 ** attempt))
    print("session established\n", flush=True)

    for r in sample:
        isbn = r["viaAlt"] if r.get("viaAlt") else r["isbn"]
        entry = None
        for attempt in range(6):
            res = page.evaluate(JS_FETCH, [f"https://www.goodreads.com/book/isbn/{isbn}"])[0]
            final, e = classify(res["status"], res["body"], res.get("url"))
            if final:
                entry = e
                break
            time.sleep(min(180, 8 * 2 ** attempt))
        if entry is None:
            unsettled += 1
            print(f"  ?? UNSETTLED  {r['title']}")
            time.sleep(2)
            continue

        if r["status"] == "isbn-404":
            same = entry.get("status") == 404
            saw = "404"
        else:
            saw = entry.get("title") or entry.get("status")
            same = str(saw) == str(r.get("theirTitle") or "")
        agree += same
        disagree += (not same)
        print(f"  {'OK ' if same else 'XX '} [{r['status']}] {r['title']}")
        print(f"      reported: {r.get('theirTitle') or '404'}")
        print(f"      re-read  : {saw}")
        time.sleep(2)
    browser.close()

print(f"\n{agree} reproduced, {disagree} did not, {unsettled} unsettled")
