from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width':1600, 'height':1000}, device_scale_factor=1)
    page.goto('http://127.0.0.1:8000/app/', wait_until='networkidle')
    page.wait_for_timeout(8000)
    page.screenshot(path=str(ROOT/'overview.png'))
    print(page.locator('body').inner_text())
    page.goto('http://127.0.0.1:8000/app/#dashboard', wait_until='networkidle')
    page.wait_for_timeout(3000)
    page.screenshot(path=str(ROOT/'farm.png'))
    (ROOT/'farm-text.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
    browser.close()
