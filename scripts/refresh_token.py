#!/usr/bin/env python3
"""
Upstox Token Auto-Refresh Script
=================================
Runs daily via GitHub Actions cron job.
- Logs into Upstox using your credentials (headless browser)
- Captures the new access token
- Updates Vercel environment variable
- Triggers Vercel redeploy
- Saves token to Supabase for the app to use

Requirements:
  pip install playwright python-dotenv requests
  playwright install chromium

Environment variables needed (set as GitHub Secrets):
  UPSTOX_CLIENT_ID       - Your Upstox app's API key
  UPSTOX_CLIENT_SECRET   - Your Upstox app's API secret
  UPSTOX_REDIRECT_URI    - Your Upstox app's redirect URI (e.g. https://yourapp.vercel.app/callback)
  UPSTOX_MOBILE          - Your Upstox login mobile number
  UPSTOX_PIN             - Your Upstox 6-digit PIN
  UPSTOX_TOTP_SECRET     - Your TOTP secret key (from Upstox 2FA setup)
  VERCEL_TOKEN           - Vercel API token (from vercel.com/account/tokens)
  VERCEL_PROJECT_ID      - Your Vercel project ID
  VERCEL_TEAM_ID         - Your Vercel team ID (optional, leave blank if personal)
  SUPABASE_URL           - Your Supabase project URL
  SUPABASE_SERVICE_KEY   - Supabase service role key (NOT anon key — has write access)
"""

import os
import sys
import json
import time
import hmac
import struct
import hashlib
import base64
import requests
import asyncio
from datetime import datetime
from urllib.parse import urlencode, urlparse, parse_qs

# ── TOTP generator (no external lib needed) ───────────────────────────
def generate_totp(secret: str, interval: int = 30) -> str:
    """Generate TOTP code from base32 secret."""
    try:
        key = base64.b32decode(secret.upper().replace(' ', ''))
    except Exception:
        print("❌ Invalid TOTP secret — must be base32 encoded")
        sys.exit(1)
    counter = int(time.time()) // interval
    msg = struct.pack('>Q', counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = struct.unpack('>I', h[offset:offset+4])[0] & 0x7FFFFFFF
    return str(code % 1000000).zfill(6)

# ── Upstox OAuth flow ─────────────────────────────────────────────────
async def get_upstox_token():
    """Automate Upstox login and capture authorization code."""
    from playwright.async_api import async_playwright

    client_id     = os.environ['UPSTOX_CLIENT_ID']
    client_secret = os.environ['UPSTOX_CLIENT_SECRET']
    redirect_uri  = os.environ['UPSTOX_REDIRECT_URI']
    mobile        = os.environ['UPSTOX_MOBILE']
    pin           = os.environ['UPSTOX_PIN']
    totp_secret   = os.environ['UPSTOX_TOTP_SECRET']

    auth_url = (
        f"https://api.upstox.com/v2/login/authorization/dialog"
        f"?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
    )

    auth_code = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page    = await context.new_page()

        # Intercept redirect to capture auth code
        async def handle_response(response):
            nonlocal auth_code
            url = response.url
            if redirect_uri in url and 'code=' in url:
                parsed = urlparse(url)
                params = parse_qs(parsed.query)
                if 'code' in params:
                    auth_code = params['code'][0]
                    print(f"✅ Auth code captured: {auth_code[:10]}…")

        page.on('response', handle_response)

        print("🌐 Opening Upstox login page…")
        await page.goto(auth_url, wait_until='networkidle')
        await page.wait_for_timeout(2000)

        # Step 1: Enter mobile number
        print("📱 Entering mobile number…")
        try:
            mobile_input = await page.wait_for_selector('input[type="text"], input[placeholder*="mobile"], input[placeholder*="Mobile"], input[name="mobileNum"]', timeout=10000)
            await mobile_input.fill(mobile)
            await page.keyboard.press('Enter')
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"⚠️ Mobile input step: {e}")

        # Step 2: Enter PIN
        print("🔑 Entering PIN…")
        try:
            pin_inputs = await page.query_selector_all('input[type="password"], input[type="tel"]')
            if len(pin_inputs) >= 1:
                # PIN may be individual digit boxes
                if len(pin_inputs) >= 6:
                    for i, digit in enumerate(pin):
                        await pin_inputs[i].fill(digit)
                        await page.wait_for_timeout(100)
                else:
                    await pin_inputs[0].fill(pin)
            await page.wait_for_timeout(1000)
            # Click continue/submit button
            btn = await page.query_selector('button[type="submit"], button:has-text("Continue"), button:has-text("Login")')
            if btn:
                await btn.click()
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"⚠️ PIN step: {e}")

        # Step 3: TOTP
        totp = generate_totp(totp_secret)
        print(f"🔐 Entering TOTP: {totp}")
        try:
            totp_inputs = await page.query_selector_all('input[type="text"], input[type="tel"], input[type="number"]')
            if len(totp_inputs) >= 6:
                for i, digit in enumerate(totp):
                    await totp_inputs[i].fill(digit)
                    await page.wait_for_timeout(80)
            elif totp_inputs:
                await totp_inputs[0].fill(totp)
            await page.wait_for_timeout(500)
            btn = await page.query_selector('button[type="submit"], button:has-text("Continue"), button:has-text("Verify")')
            if btn:
                await btn.click()
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"⚠️ TOTP step: {e}")

        # Wait for redirect with auth code
        await page.wait_for_timeout(5000)
        await browser.close()

    if not auth_code:
        print("❌ Failed to capture auth code — check credentials or Upstox page structure")
        sys.exit(1)

    # Exchange auth code for access token
    print("🔄 Exchanging auth code for access token…")
    response = requests.post(
        'https://api.upstox.com/v2/login/authorization/token',
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
        data={
            'code':          auth_code,
            'client_id':     client_id,
            'client_secret': client_secret,
            'redirect_uri':  redirect_uri,
            'grant_type':    'authorization_code',
        }
    )

    if response.status_code != 200:
        print(f"❌ Token exchange failed: {response.status_code} {response.text}")
        sys.exit(1)

    data = response.json()
    token = data.get('access_token')
    if not token:
        print(f"❌ No access_token in response: {data}")
        sys.exit(1)

    print(f"✅ Access token obtained: {token[:20]}…")
    return token

# ── Update Vercel env var ─────────────────────────────────────────────
def update_vercel_token(token: str):
    vercel_token   = os.environ['VERCEL_TOKEN']
    project_id     = os.environ['VERCEL_PROJECT_ID']
    team_id        = os.environ.get('VERCEL_TEAM_ID', '')

    headers = {
        'Authorization': f'Bearer {vercel_token}',
        'Content-Type':  'application/json',
    }
    base_url = f'https://api.vercel.com/v9/projects/{project_id}/env'
    params   = {'teamId': team_id} if team_id else {}

    # Check if env var already exists
    r = requests.get(base_url, headers=headers, params=params)
    envs = r.json().get('envs', [])
    existing = next((e for e in envs if e['key'] == 'VITE_OWNER_UPSTOX_TOKEN'), None)

    if existing:
        # Update existing
        env_id = existing['id']
        r = requests.patch(
            f'{base_url}/{env_id}',
            headers=headers,
            params=params,
            json={'value': token, 'target': ['production', 'preview', 'development']},
        )
        if r.status_code in (200, 201):
            print("✅ Vercel env var updated")
        else:
            print(f"⚠️ Vercel update: {r.status_code} {r.text}")
    else:
        # Create new
        r = requests.post(
            base_url,
            headers=headers,
            params=params,
            json={
                'key':    'VITE_OWNER_UPSTOX_TOKEN',
                'value':  token,
                'type':   'plain',
                'target': ['production', 'preview', 'development'],
            },
        )
        if r.status_code in (200, 201):
            print("✅ Vercel env var created")
        else:
            print(f"⚠️ Vercel create: {r.status_code} {r.text}")

# ── Trigger Vercel redeploy ───────────────────────────────────────────
def trigger_redeploy():
    vercel_token = os.environ['VERCEL_TOKEN']
    project_id   = os.environ['VERCEL_PROJECT_ID']
    team_id      = os.environ.get('VERCEL_TEAM_ID', '')

    headers = {'Authorization': f'Bearer {vercel_token}', 'Content-Type': 'application/json'}
    params  = {'teamId': team_id} if team_id else {}

    # Get latest deployment
    r = requests.get(
        f'https://api.vercel.com/v6/deployments',
        headers=headers,
        params={**params, 'projectId': project_id, 'limit': 1},
    )
    deployments = r.json().get('deployments', [])
    if not deployments:
        print("⚠️ No deployments found to redeploy")
        return

    latest = deployments[0]
    # Trigger redeploy using the same git source
    r = requests.post(
        'https://api.vercel.com/v13/deployments',
        headers=headers,
        params=params,
        json={
            'name':       latest.get('name'),
            'gitSource':  latest.get('meta', {}),
            'target':     'production',
        },
    )
    if r.status_code in (200, 201):
        deploy_url = r.json().get('url', '')
        print(f"✅ Redeploy triggered: https://{deploy_url}")
    else:
        print(f"⚠️ Redeploy: {r.status_code} {r.text}")

# ── Save token to Supabase (so app reads it without redeploy) ─────────
def save_to_supabase(token: str):
    """
    Saves the owner token to a Supabase table so the app can read it
    at runtime without needing a redeploy.
    This is the cleanest approach — no redeploy needed at all!
    """
    supabase_url = os.environ.get('SUPABASE_URL')
    service_key  = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not service_key:
        print("⚠️ SUPABASE_URL or SUPABASE_SERVICE_KEY not set — skipping Supabase save")
        return

    headers = {
        'apikey':        service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
    }

    # Upsert into owner_token table (single row, id='owner')
    r = requests.post(
        f'{supabase_url}/rest/v1/owner_token',
        headers=headers,
        json={'id': 'owner', 'token': token, 'updated_at': datetime.utcnow().isoformat()},
    )
    if r.status_code in (200, 201, 204):
        print("✅ Token saved to Supabase owner_token table")
    else:
        print(f"⚠️ Supabase save: {r.status_code} {r.text}")

# ── Main ──────────────────────────────────────────────────────────────
async def main():
    print(f"\n{'='*50}")
    print(f"  Upstox Token Refresh — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*50}\n")

    # 1. Get fresh token via automated login
    token = await get_upstox_token()

    # 2. Save to Supabase (app reads this — no redeploy needed)
    save_to_supabase(token)

    # 3. Also update Vercel env var (for new deployments)
    update_vercel_token(token)

    # 4. Trigger redeploy so VITE_ env var is refreshed in the bundle
    #    (only needed if app reads VITE_ at build time, not runtime)
    # trigger_redeploy()  # Uncomment if needed

    print(f"\n✅ Token refresh complete at {datetime.now().strftime('%H:%M:%S')}")

if __name__ == '__main__':
    asyncio.run(main())
