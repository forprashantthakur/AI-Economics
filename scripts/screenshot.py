"""Capture screenshots of app routes for visual review.

Usage: python3 scripts/screenshot.py <base_url> <out_dir> <route>[,<route>...] [--width 1440] [--dark] [--full]
Routes are hash routes such as 'dashboard' or 'costing/llm'.
"""
import os, sys, asyncio
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.async_api import async_playwright

async def main():
    base, out, routes = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
    width = int(sys.argv[sys.argv.index('--width') + 1]) if '--width' in sys.argv else 1440
    dark = '--dark' in sys.argv
    full = '--full' in sys.argv
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': width, 'height': 900}, color_scheme='dark' if dark else 'light', device_scale_factor=1)
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        for r in routes:
            await page.goto(f"{base}#/{r}")
            await page.wait_for_timeout(1500)
            name = r.replace('/', '_').replace('?', '_').replace('=', '-') or 'root'
            path = os.path.join(out, f"{name}{'_dark' if dark else ''}_{width}.png")
            await page.screenshot(path=path, full_page=full)
            print(path)
        if errors:
            print('ERRORS:', *errors[:20], sep='\n  ')
        await b.close()

asyncio.run(main())
