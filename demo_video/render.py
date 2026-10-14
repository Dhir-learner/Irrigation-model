"""Assemble a 180-second, 1080p narrated walkthrough with burned-in captions."""
import json, re, subprocess, wave, textwrap, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT=Path(__file__).parent.resolve()
FF=imageio_ffmpeg.get_ffmpeg_exe()
SCENES=json.loads((ROOT/'storyboard.json').read_text())
FONT='C:/Windows/Fonts/segoeui.ttf'
BOLD='C:/Windows/Fonts/segoeuib.ttf'

def run(args):
    proc=subprocess.run([FF,'-hide_banner','-y',*args],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if proc.returncode: raise RuntimeError(proc.stderr[-5000:])
    return proc.stderr
def duration(path):
    r=subprocess.run([FF,'-hide_banner','-i',str(path)],capture_output=True,text=True)
    h,m,s=re.search(r'Duration: (\d+):(\d+):([\d.]+)',r.stderr).groups()
    return int(h)*3600+int(m)*60+float(s)
def ass_time(t):
    cs=round(t*100);return f'{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}'
def srt_time(t):
    ms=round(t*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
def caption_chunks(text):
    out=[]
    for sentence in re.split(r'(?<=[.!?]) +',text):
        words=sentence.split()
        while words:
            take=min(17,len(words))
            if len(words)>take and len(words)-take<5: take=len(words)//2
            out.append(' '.join(words[:take]));words=words[take:]
    return out

all_srt=[];offset=0;chapter_lines=[]
for i,scene in enumerate(SCENES):
    ident=scene['id'];dur=scene['duration']
    frame=Image.new('RGB',(1920,1080),'#06130f');d=ImageDraw.Draw(frame)
    for x in range(0,1920,48):d.line((x,64,x,964),fill='#0b2018')
    for y in range(64,964,48):d.line((0,y,1920,y),fill='#0b2018')
    d.rectangle((160,63,1759,964),outline='#285341',width=2)
    d.rounded_rectangle((34,16,68,48),radius=9,fill='#16ceac')
    d.text((45,17),'A',font=ImageFont.truetype(BOLD,20),fill='#052b22')
    d.text((86,15),scene['title'],font=ImageFont.truetype(BOLD,27),fill='#e6fff4')
    d.text((1515,22),'AQUAADVISORY  /  DEMO',font=ImageFont.truetype(BOLD,16),fill='#72aa95')
    d.text((34,985),f'{i+1:02d} / 13',font=ImageFont.truetype(BOLD,16),fill='#39dbb2')
    d.line((0,1076,1920,1076),fill='#183b2c',width=5)
    d.line((0,1076,int(1920*(offset+dur)/180),1076),fill='#22d8ae',width=5)
    frame.save(ROOT/(ident+'-frame.png'))
    with wave.open(str(ROOT/(ident+'.wav'))) as w: audio_d=w.getnframes()/w.getframerate()
    tempo=max(1,audio_d/(dur-0.9));spoken=audio_d/tempo
    chunks=caption_chunks(scene['narration']);total=sum(len(c.split()) for c in chunks);cursor=.35
    header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,29,&H00F3FFF8,&H00FFFFFF,&H000F1306,&H000F1306,0,0,0,0,100,100,0,0,1,0,0,2,180,180,23,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    lines=[]
    for c in chunks:
        end=cursor+spoken*len(c.split())/total
        wrapped=r'\N'.join(textwrap.wrap(c,width=98))
        lines.append(f'Dialogue: 0,{ass_time(cursor)},{ass_time(end)},Default,,0,0,0,,{wrapped}')
        all_srt.append(f'{len(all_srt)+1}\n{srt_time(offset+cursor)} --> {srt_time(offset+end)}\n'+ '\n'.join(textwrap.wrap(c,width=85))+'\n')
        cursor=end
    (ROOT/(ident+'.ass')).write_text(header+'\n'.join(lines),encoding='utf-8')
    chapter_lines.append(f'{int(offset)//60:02d}:{int(offset)%60:02d}  {scene["title"]}')
    offset+=dur
    if len(sys.argv)>1 and ident not in sys.argv[1:]:continue
    rawdur=duration(ROOT/(ident+'.webm'))
    capture=json.loads((ROOT/(ident+'-capture.json')).read_text())['capture_duration']
    start=max(0,rawdur-capture)
    stretch=min(1.35,(dur-.15)/capture)
    vf=(f'[0:v]setpts={stretch:.6f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur}[screen];'
        f'[1:v][screen]overlay=160:64:shortest=1,ass={ident}.ass,fade=t=in:st=0:d=0.22,fade=t=out:st={dur-.22}:d=0.22,format=yuv420p[v];'
        f'[2:a]atempo={tempo:.6f},adelay=350:all=1,apad,atrim=duration={dur},alimiter=limit=0.95[a]')
    run(['-ss',str(start),'-i',ident+'.webm','-loop','1','-i',ident+'-frame.png','-i',ident+'.wav','-filter_complex',vf,
         '-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','20','-threads','4','-c:a','aac','-b:a','160k','-ar','48000','-t',str(dur),ident+'-final.mp4'])
    print('RENDERED',ident,flush=True)

(ROOT/'AquaAdvisory_Demo.srt').write_text('\n'.join(all_srt),encoding='utf-8')
(ROOT/'chapters.txt').write_text('\n'.join(chapter_lines),encoding='utf-8')
if all((ROOT/(s['id']+'-final.mp4')).exists() for s in SCENES):
    (ROOT/'concat.txt').write_text('\n'.join("file '"+s['id']+"-final.mp4'" for s in SCENES),encoding='utf-8')
    metadata=';FFMETADATA1\ntitle=AquaAdvisory - Project Demo\ncomment=Local application walkthrough. Prototype decision support.\n'
    elapsed=0
    for scene in SCENES:
        metadata+=f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={elapsed*1000}\nEND={(elapsed+scene["duration"])*1000}\ntitle={scene["title"]}\n'
        elapsed+=scene['duration']
    (ROOT/'metadata.txt').write_text(metadata,encoding='utf-8')
    run(['-f','concat','-safe','0','-i','concat.txt','-i','metadata.txt','-map_metadata','1','-map_chapters','1','-c','copy','-t','180','-movflags','+faststart','AquaAdvisory_Demo_3min.mp4'])
    print('COMPLETE: AquaAdvisory_Demo_3min.mp4',flush=True)
