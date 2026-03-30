#!/usr/bin/env python3
"""
Polymarket - Find nearly-decided markets (97-99% probability)
"""

import sys
import urllib.request
import json
from datetime import datetime

GAMMA_API = "https://gamma-api.polymarket.com"

# Thresholds for "basically decided"
MIN_PROB = 0.97
MAX_PROB = 0.99  # exclude 1.0 (already fully resolved)


def fetch_json(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": "polymarket-checker/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def get_markets(limit: int = 500, offset: int = 0) -> list:
    url = (
        f"{GAMMA_API}/markets"
        f"?active=true&closed=false"
        f"&limit={limit}&offset={offset}"
    )
    return fetch_json(url)


def token_price(token: dict) -> float:
    """Extract numeric price from a token dict."""
    try:
        return float(token.get("price", 0))
    except (TypeError, ValueError):
        return 0.0


def collect_nearly_decided(min_prob: float = MIN_PROB, max_prob: float = MAX_PROB) -> list:
    results = []
    offset = 0
    limit = 500
    fetched = 0

    print("Fetching markets from Polymarket...", flush=True)
    while True:
        markets = get_markets(limit=limit, offset=offset)
        if not markets:
            break

        for market in markets:
            tokens = market.get("tokens") or []
            for token in tokens:
                price = token_price(token)
                if min_prob <= price <= max_prob:
                    results.append({
                        "question": market.get("question", "Unknown"),
                        "outcome": token.get("outcome", "Yes"),
                        "probability": price,
                        "volume": float(market.get("volume", 0) or 0),
                        "end_date": market.get("endDate") or market.get("end_date", ""),
                        "url": f"https://polymarket.com/event/{market.get('slug', '')}",
                        "market_slug": market.get("slug", ""),
                    })
                    break  # only report the leading outcome per market

        fetched += len(markets)
        print(f"  Scanned {fetched} markets, found {len(results)} so far...", flush=True)

        if len(markets) < limit:
            break
        offset += limit

    return results


def format_results(results: list) -> None:
    if not results:
        print("\nNo markets found in the 97–99% range.")
        return

    # Sort: highest probability first, then by volume
    results.sort(key=lambda r: (-r["probability"], -r["volume"]))

    print(f"\n{'='*80}")
    print(f"  NEARLY-DECIDED MARKETS  ({len(results)} found, probability {int(MIN_PROB*100)}–{int(MAX_PROB*100)}%)")
    print(f"{'='*80}\n")

    for i, r in enumerate(results, 1):
        prob_pct = f"{r['probability']*100:.1f}%"
        vol = f"${r['volume']:,.0f}"
        end = r["end_date"][:10] if r["end_date"] else "N/A"
        print(f"[{i:3}] {prob_pct}  {r['question']}")
        print(f"       Outcome: {r['outcome']}  |  Volume: {vol}  |  End: {end}")
        print(f"       {r['url']}")
        print()


def main():
    min_p = MIN_PROB
    max_p = MAX_PROB

    # Optional CLI args: check_decided.py [min%] [max%]
    # e.g.  python check_decided.py 95 99
    if len(sys.argv) >= 3:
        try:
            min_p = float(sys.argv[1]) / 100
            max_p = float(sys.argv[2]) / 100
        except ValueError:
            print("Usage: python check_decided.py [min_pct] [max_pct]")
            sys.exit(1)
    elif len(sys.argv) == 2:
        print("Usage: python check_decided.py [min_pct] [max_pct]")
        sys.exit(1)

    print(f"Looking for markets with probability between {min_p*100:.0f}% and {max_p*100:.0f}%")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    results = collect_nearly_decided(min_prob=min_p, max_prob=max_p)
    format_results(results)


if __name__ == "__main__":
    main()
