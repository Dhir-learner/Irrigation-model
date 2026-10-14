"""Capture genuine local application interactions; no production data is edited."""
import json, time, sys
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.resolve()
SCENES=json.loads((ROOT/'storyboard.json').read_text())
URL='http://127.0.0.1:8000/app/'

def pause(page, sec): page.wait_for_timeout(sec*1000)
def scroll(page, y):
    page.evaluate('(y)=>window.scrollTo({top:y,behavior:"smooth"})',y)
    pause(page,1)
def center(page, locator, offset=130):
    y=locator.evaluate('(e)=>e.getBoundingClientRect().top+window.scrollY')
    scroll(page,max(0,y-offset))
def tab(page,name):
    page.get_by_role('tab',name=name,exact=True).click()
    pause(page,.8)
    center(page,page.get_by_role('tablist'),90)
def move(page,loc):
    box=loc.bounding_box()
    if box: page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2,steps=20)
def click(page,loc):
    move(page,loc); pause(page,.3); loc.click()
def card(page,text): return page.locator('.card').filter(has=page.get_by_text(text,exact=True)).first

def title_page(page, end=False):
    title='From field data<br>to informed irrigation.' if end else 'Water where it is needed.<br><span>When it is needed.</span>'
    subtitle='Prediction. Planning. Human review.' if end else 'A three-minute walkthrough of sugarcane irrigation intelligence.'
    page.set_content('''<html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#06140f;color:#eefbf4;font-family:Segoe UI,Arial;overflow:hidden}
    .grid{position:absolute;inset:0;background-image:linear-gradient(#20d6ac0b 1px,transparent 1px),linear-gradient(90deg,#20d6ac0b 1px,transparent 1px);background-size:48px 48px}
    .orb{position:absolute;width:650px;height:650px;border-radius:50%;background:radial-gradient(circle,#13bb9140,transparent 70%);right:-80px;top:-100px;animation:breathe 5s infinite alternate}
    main{position:relative;padding:96px 100px} .eyebrow{color:#24dfb5;letter-spacing:4px;font-size:16px;font-weight:700}
    h1{font-size:69px;line-height:1.15;letter-spacing:-2px;margin:45px 0 28px}h1 span{color:#27d9c6}p{color:#a9c5b9;font-size:24px}
    .steps{display:flex;gap:18px;margin-top:68px}.step{width:290px;background:#10261f;border:1px solid #214e3d;border-radius:18px;padding:24px}
    .step b{color:#24dfb5;display:block;margin-bottom:10px;font-size:13px;letter-spacing:2px}.step strong{font-size:24px}
    .brand{position:absolute;right:90px;top:94px;font-size:24px;font-weight:700}.brand i{display:inline-block;border-radius:15px;background:#1bd6bd;color:#06382e;padding:10px 15px;margin-right:10px;font-style:normal}
    footer{margin-top:40px;font-size:15px;color:#779e8b} @keyframes breathe{to{transform:scale(1.2)}}
    </style></head><body><div class="grid"></div><div class="orb"></div><div class="brand"><i>~</i>AquaAdvisory</div><main>
    <div class="eyebrow">KJS-AGR-01 / PROJECT DEMO</div><h1>'''+title+'''</h1><p>'''+subtitle+'''</p>
    <div class="steps"><div class="step"><b>01 / UNDERSTAND</b><strong>Farm advisories</strong></div><div class="step"><b>02 / COORDINATE</b><strong>Fleet & pump planning</strong></div><div class="step"><b>03 / REVIEW</b><strong>Transparent decisions</strong></div></div>
    <footer>Prototype decision support • Confirm recommendations with a field officer</footer></main></body></html>''')

def prepare(page,idx):
    if idx in (0,12): title_page(page,idx==12); return
    view={1:'overview',2:'dashboard',3:'dashboard',4:'dashboard',5:'dashboard',6:'fleet',7:'analytics',8:'schedule',9:'dashboard',10:'validation',11:'dashboard'}[idx]
    page.goto(URL+'#'+view,wait_until='domcontentloaded')
    page.get_by_text('API online',exact=True).wait_for(timeout=30000)
    pause(page,3)
    page.add_style_tag(content='html{scroll-behavior:smooth}body{padding-bottom:160px} ::-webkit-scrollbar{width:6px} #demo-cursor{position:fixed;width:19px;height:19px;border:2px solid #9affdf;border-radius:50%;background:#2be5ae38;box-shadow:0 0 0 6px #2be5ae16;z-index:99999;pointer-events:none;left:1450px;top:75px}')
    page.evaluate('''()=>{let el=document.createElement('div');el.id='demo-cursor';document.body.append(el);document.addEventListener('mousemove',e=>{el.style.left=(e.clientX-9)+'px';el.style.top=(e.clientY-9)+'px'})}''')
    if idx in (3,4,5,9,11):
        page.locator('#f-method').select_option('drip')
        pause(page,1)
    if idx==3: scroll(page,345)
    if idx==4: tab(page,'Crop & soil')
    if idx==5: tab(page,'Model & what-if')
    if idx==6: center(page,page.get_by_text('Plots by irrigation status',exact=True),140)
    if idx==9: scroll(page,330)
    if idx==11: tab(page,'Review')

def action(page,idx):
    if idx in (0,12): pause(page,5)
    elif idx==1:
        pause(page,2); scroll(page,300)
        canvas=page.locator('canvas').first
        box=canvas.bounding_box()
        page.mouse.move(box['x']+250,box['y']+220);page.mouse.down();page.mouse.move(box['x']+400,box['y']+200,steps=45);page.mouse.up();pause(page,3)
    elif idx==2:
        pause(page,2); move(page,page.locator('#f-farm'));pause(page,1)
        move(page,page.locator('#f-method'));page.locator('#f-method').select_option('drip');pause(page,4)
    elif idx==3:
        pause(page,4);tab(page,'Water balance');pause(page,4)
    elif idx==4:
        pause(page,2);box=page.locator('canvas').first.bounding_box()
        page.mouse.move(box['x']+280,box['y']+200);page.mouse.down();page.mouse.move(box['x']+420,box['y']+220,steps=50);page.mouse.up();pause(page,3)
    elif idx==5:
        pause(page,2); slider=page.locator('input[type=range]').nth(1)
        move(page,slider);slider.focus();slider.press('End');pause(page,1)
        click(page,page.get_by_role('button',name='Run simulation',exact=True));pause(page,3)
        page.get_by_role('columnheader',name='Scenario',exact=True).wait_for();scroll(page,650);pause(page,3)
    elif idx==6:
        pause(page,3)
        toggle=page.get_by_role('radio',name='3D',exact=True)
        click(page,toggle);pause(page,4)
    elif idx==7:
        pause(page,3);scroll(page,400);pause(page,4)
    elif idx==8:
        pause(page,2);click(page,page.get_by_role('button',name='Build schedule',exact=True));pause(page,2)
        page.get_by_text('Feeder load',exact=True).wait_for();scroll(page,440);pause(page,3);scroll(page,840);pause(page,3)
    elif idx==9:
        pause(page,1);move(page,page.locator('.lang-select'));page.locator('.lang-select').select_option('kn');pause(page,3)
        page.locator('.lang-select').select_option('hi');pause(page,3)
    elif idx==10:
        pause(page,4);scroll(page,340);pause(page,4)
    elif idx==11:
        pause(page,2); move(page,page.locator('#r-decision')); page.locator('#r-decision').select_option('modified');pause(page,2)
        move(page,page.locator('#r-comment'));pause(page,2)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True,args=['--enable-unsafe-swiftshader'])
    selected=set(sys.argv[1:])
    for idx,scene in enumerate(SCENES):
        if selected and scene['id'] not in selected: continue
        context=browser.new_context(viewport={'width':1600,'height':900},record_video_dir=str(ROOT/'raw'),record_video_size={'width':1600,'height':900},locale='en-IN',timezone_id='Asia/Kolkata')
        context.route('**/*',lambda route: route.continue_() if urlparse(route.request.url).hostname in ('127.0.0.1','localhost') else route.abort())
        context.add_init_script("localStorage.setItem('aqua.settings',JSON.stringify({farmId:'MM-MD-0110',plantingDate:'2026-04-17',soilType:'sandy_loam',method:'furrow',pumpFlow:18}));localStorage.setItem('theme','dark');")
        page=context.new_page()
        try:
            prepare(page,idx)
            start=time.monotonic()
            action(page,idx)
            pause(page,1)
            page.screenshot(path=str(ROOT/(scene['id']+'.png')))
            (ROOT/(scene['id']+'-text.txt')).write_text(page.locator('main').inner_text() if idx in (0,12) else page.locator('.main-content').inner_text(),encoding='utf-8')
            elapsed=time.monotonic()-start
            video=page.video
            context.close()
            video.save_as(str(ROOT/(scene['id']+'.webm')))
            (ROOT/(scene['id']+'-capture.json')).write_text(json.dumps({'capture_duration':elapsed}),encoding='utf-8')
            print('CAPTURED',scene['id'],round(elapsed,2),flush=True)
        except Exception:
            page.screenshot(path=str(ROOT/(scene['id']+'-error.png')))
            context.close()
            raise
    browser.close()
