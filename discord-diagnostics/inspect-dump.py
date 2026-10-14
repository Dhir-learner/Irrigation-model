import os,struct,pathlib,json
p=max((pathlib.Path(os.environ['APPDATA'])/'discord/Crashpad/reports').glob('*.dmp'),key=lambda p:p.stat().st_mtime)
b=p.read_bytes()
u32=lambda o:struct.unpack_from('<I',b,o)[0]
u64=lambda o:struct.unpack_from('<Q',b,o)[0]
streams={u32(u32(12)+i*12):(u32(u32(12)+i*12+4),u32(u32(12)+i*12+8)) for i in range(u32(8))}
mods=[]
if 4 in streams:
 r=streams[4][1]
 for i in range(u32(r)):
  o=r+4+i*108;n=u32(o+20);name=b[n+4:n+4+u32(n)].decode('utf-16-le',errors='replace');mods.append((u64(o),u32(o+8),name))
 print('MODULES:')
 for base,size,name in mods:print(hex(base),name)
if 6 in streams:
 r=streams[6][1];code=u32(r+8);addr=u64(r+24)
 print('EXCEPTION',hex(code),'ADDRESS',hex(addr),'THREAD',u32(r))
 print('FAULT MODULE',[(name,hex(addr-base)) for base,size,name in mods if base<=addr<base+size])
