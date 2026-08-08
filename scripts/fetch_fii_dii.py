#!/usr/bin/env python3
"""Fetch daily FII/FPI & DII cash-market flows from NSE and upsert to Supabase."""

import os
import sys
from datetime import datetime

import requests

NSE_ENDPOINT = 'https://www.nseindia.com/api/fiidiiTradeReact'
NSE_REFERER = 'https://www.nseindia.com/reports/fii-dii'


def parse_nse_date(value: str) -> str:
    return datetime.strptime(value.strip(), '%d-%b-%Y').date().isoformat()


def fetch_nse_fii_dii() -> dict:
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


def upsert_supabase(row: dict) -> None:
    supabase_url = os.environ.get('SUPABASE_URL')
    service_key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not service_key:
        raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')

    payload = {
        'trade_date': row['trade_date'],
        'segment': 'combined',
        'fii_buy': row['fii_buy'],
        'fii_sell': row['fii_sell'],
        'fii_net': row['fii_net'],
        'dii_buy': row['dii_buy'],
        'dii_sell': row['dii_sell'],
        'dii_net': row['dii_net'],
        'source': 'nse',
        'fetched_at': datetime.utcnow().isoformat() + 'Z',
    }
    response = requests.post(
        f'{supabase_url.rstrip("/")}/rest/v1/fii_dii_daily',
        headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
        },
        params={'on_conflict': 'trade_date'},
        json=payload,
        timeout=30,
    )
    if response.status_code not in (200, 201, 204):
        raise RuntimeError(f'Supabase upsert failed: {response.status_code} {response.text[:300]}')


def main() -> int:
    row = fetch_nse_fii_dii()
    print(
        f"NSE {row['trade_date']}: FII net {row['fii_net']:+.2f} Cr, "
        f"DII net {row['dii_net']:+.2f} Cr"
    )
    upsert_supabase(row)
    print('Upserted to fii_dii_daily')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
