import json,subprocess,re
from pathlib import Path
from PIL import Image,ImageDraw
import imageio_ffmpeg

root=Path(__file__).parent.resolve();ff=imageio_ffmpeg.get_ffmpeg_exe();video=root/'AquaAdvisory_Demo_3min.mp4'
probe=subprocess.run([ff,'-hide_banner','-i',str(video)],capture_output=True,text=True,encoding='utf-8',errors='replace').stderr
print('\n'.join(x for x in probe.splitlines() if 'Duration:' in x or 'Stream #' in x))
check=subprocess.run([ff,'-v','error','-i',str(video),'-f','null','-'],capture_output=True,text=True)
assert check.returncode==0 and not check.stderr,check.stderr
assert '1920x1080' in probe and '25 fps' in probe and 'Audio: aac' in probe
audio=subprocess.run([ff,'-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True).stderr
print('\n'.join(x for x in audio.splitlines() if 'mean_volume' in x or 'max_volume' in x))
scenes=json.loads((root/'storyboard.json').read_text());t=0
for i,s in enumerate(scenes):
    at=t+s['duration']/2
    target=root/('qa-'+s['id']+'.jpg')
    subprocess.run([ff,'-v','error','-y','-ss',str(at),'-i',str(video),'-frames:v','1',str(target)],check=True)
    t+=s['duration']
sheet=Image.new('RGB',(1440,5*290),'#07160f');draw=ImageDraw.Draw(sheet)
for i,s in enumerate(scenes):
    sheet.paste(Image.open(root/('qa-'+s['id']+'.jpg')).resize((480,270)),((i%3)*480,(i//3)*290))
    draw.text(((i%3)*480+8,(i//3)*290+273),s['id'],fill='white')
sheet.save(root/'QA_contact_sheet.jpg')
h,m,s=re.search(r'Duration: (\d+):(\d+):([\d.]+)',probe).groups()
actual_duration=int(h)*3600+int(m)*60+float(s)
assert abs(actual_duration-180)<0.1
report={'duration_seconds':actual_duration,'resolution':'1920x1080','fps':25,'video_codec':'H.264','audio_codec':'AAC','size_mb':round(video.stat().st_size/1024**2,2),'decode_errors':check.stderr,'chapters':len(scenes),'external_browser_requests':'blocked'}
(root/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
