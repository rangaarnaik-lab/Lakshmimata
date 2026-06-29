import urllib.request
import urllib.error
import json
import ssl

TOKEN = "your_new_token_here"  # paste your NEW token

# Fix SSL issue on Windows
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://api.upstox.com/v2/historical-candle/NSE_EQ%7CRELIANCE/day/2024-01-10/2024-01-01"

req = urllib.request.Request(url)
req.add_header("Authorization", f"Bearer {TOKEN}")
req.add_header("Accept", "application/json")

try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read())
        print("✅ Token works!")
        print(f"Got {len(data['data']['candles'])} candles for RELIANCE")
except Exception as e:
    print(f"❌ Error: {e}")