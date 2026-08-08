#!/usr/bin/env python3
"""Fetch daily FII/FPI & DII cash-market flows and upsert to Supabase.

Today's row: NSE fiidiiTradeReact (combined NSE+BSE+MSEI).
Historical backfill: NSE-sourced archive via history-full JSON (up to ~127 sessions).
"""

import argparse
import os
import sys
from datetime import datetime

import requests

NSE_ENDPOINT = 'https://www.nseindia.com/api/fiidiiTradeReact'
NSE_REFERER = 'https://www.nseindia.com/reports/fii-dii'
# Public NSE-sourced archive (combined cash-market FII/DII). Used only for backfill.
HISTORY_ENDPOINT = 'https://fii-diidata.mrchartist.com/api/history-full'


def parse_nse_date(value: str) -> str:
    return datetime.strptime(value.strip(), '%d-%b-%Y').date().isoformat()


def nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': NSE_REFERER,
    })
    session.get('https://www.nseindia.com/', timeout=20)
    return session


def fetch_nse_fii_dii() -> dict:
    session = nse_session()
    response = session.get(NSE_ENDPOINT, timeout=20)
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise RuntimeError('Unexpected NSE FII/DII payload')

    out = {'trade_date': None, 'fii_buy': None, 'fii_sell': None, 'fii_net': None,
           'dii_buy': None, 'dii_sell': None, 'dii_net': None}
    for row in rows:
        category = (row.get('category') or '').upper()
        trade_date = parse_nse_date(row['date'])
        if out['trade_date'] is None:
            out['trade_date'] = trade_date
        elif out['trade_date'] != trade_date:
            raise RuntimeError('Mixed trade dates in NSE FII/DII response')

        buy = float(row['buyValue'])
        sell = float(row['sellValue'])
        net = float(row['netValue'])
        if category.startswith('FII'):
            out['fii_buy'], out['fii_sell'], out['fii_net'] = buy, sell, net
        elif category == 'DII':
            out['dii_buy'], out['dii_sell'], out['dii_net'] = buy, sell, net

    if out['trade_date'] is None or out['fii_net'] is None or out['dii_net'] is None:
        raise RuntimeError('Incomplete NSE FII/DII row')
    return out


def fetch_history_backfill(days: int) -> list[dict]:
    """Load prior sessions from the public NSE-sourced archive."""
    response = requests.get(HISTORY_ENDPOINT, timeout=30)
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list):
        raise RuntimeError('Unexpected history payload')

    out = []
    for row in rows[:days]:
        # history-full uses compact keys; history uses long keys
        date_raw = row.get('d') or row.get('date')
        if not date_raw:
            continue
        trade_date = parse_nse_date(date_raw)
        out.append({
            'trade_date': trade_date,
            'fii_buy': float(row.get('fb') if 'fb' in row else row.get('fii_buy')),
            'fii_sell': float(row.get('fs') if 'fs' in row else row.get('fii_sell')),
            'fii_net': float(row.get('fn') if 'fn' in row else row.get('fii_net')),
            'dii_buy': float(row.get('db') if 'db' in row else row.get('dii_buy')),
            'dii_sell': float(row.get('ds') if 'ds' in row else row.get('dii_sell')),
            'dii_net': float(row.get('dn') if 'dn' in row else row.get('dii_net')),
        })
    return out


def row_to_payload(row: dict, source: str) -> dict:
    return {
        'trade_date': row['trade_date'],
        'segment': 'combined',
        'fii_buy': row['fii_buy'],
        'fii_sell': row['fii_sell'],
        'fii_net': row['fii_net'],
        'dii_buy': row['dii_buy'],
        'dii_sell': row['dii_sell'],
        'dii_net': row['dii_net'],
        'source': source,
        'fetched_at': datetime.utcnow().isoformat() + 'Z',
    }


def upsert_supabase_rows(rows: list[dict]) -> None:
    if not rows:
        return
    supabase_url = os.environ.get('SUPABASE_URL')
    service_key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not service_key:
        raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')

    response = requests.post(
        f'{supabase_url.rstrip("/")}/rest/v1/fii_dii_daily',
        headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
        },
        params={'on_conflict': 'trade_date'},
        json=rows,
        timeout=60,
    )
    if response.status_code not in (200, 201, 204):
        raise RuntimeError(f'Supabase upsert failed: {response.status_code} {response.text[:300]}')


def main() -> int:
    parser = argparse.ArgumentParser(description='Fetch FII/DII and upsert to Supabase')
    parser.add_argument(
        '--backfill-days',
        type=int,
        default=0,
        help='Also load this many prior trading sessions from archive (e.g. 30 or 126 for ~6M)',
    )
    args = parser.parse_args()

    by_date: dict[str, dict] = {}

    if args.backfill_days > 0:
        history = fetch_history_backfill(args.backfill_days)
        for row in history:
            by_date[row['trade_date']] = row_to_payload(row, 'nse-archive')
        print(f'Loaded {len(history)} archived sessions (requested {args.backfill_days})')

    latest = fetch_nse_fii_dii()
    by_date[latest['trade_date']] = row_to_payload(latest, 'nse')
    print(
        f"NSE {latest['trade_date']}: FII net {latest['fii_net']:+.2f} Cr, "
        f"DII net {latest['dii_net']:+.2f} Cr"
    )

    rows = [by_date[k] for k in sorted(by_date)]
    upsert_supabase_rows(rows)
    print(f'Upserted {len(rows)} row(s) to fii_dii_daily')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
