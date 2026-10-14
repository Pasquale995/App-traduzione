import sys, math
from PIL import Image, ImageDraw
S=sys.argv[1]
im=Image.open(S+"/pieno.png").convert("RGBA")
W,H=im.size; px=im.load()
CX,CY,R=725,553,372
RED=(241,8,9)
for y in range(H):
    for x in range(W):
        if math.hypot(x-CX,y-CY)<=R: continue
        r,g,b,_=px[x,y]
        d=math.sqrt((r-RED[0])**2+(g-RED[1])**2+(b-RED[2])**2)
        a=max(0,min(255,int((d-45)*255/120)))
        if a<255 and a>0:
            # toglie il rosso mescolato dal colore del bordo
            t=a/255
            r=int(max(0,min(255,(r-RED[0]*(1-t))/t))); g=int(max(0,min(255,(g-RED[1]*(1-t))/t))); b=int(max(0,min(255,(b-RED[2]*(1-t))/t)))
        px[x,y]=(r,g,b,a)
# pulisce i residui quasi trasparenti, poi ritaglia sul disegno
for y in range(H):
    for x in range(W):
        if px[x,y][3]<40: px[x,y]=(0,0,0,0)
bbox=im.split()[3].point(lambda v: 255 if v>=40 else 0).getbbox(); print("bbox",bbox)
art=im.crop(bbox)
w,h=art.size; side=max(w,h)
sq=Image.new("RGBA",(side,side),(0,0,0,0)); sq.paste(art,((side-w)//2,(side-h)//2),art)
sq.save(S+"/trasparente.png")
fg=Image.new("RGBA",(432,432),(0,0,0,0))
# 240 px su 432: entra tutto nel cerchio visibile del launcher (72dp su 108)
inner=sq.resize((240,240),Image.LANCZOS); fg.paste(inner,(96,96),inner)
for name,size in (("mdpi",108),("hdpi",162),("xhdpi",216),("xxhdpi",324),("xxxhdpi",432)):
    fg.resize((size,size),Image.LANCZOS).save(f"{S}/fg-{name}.png")
prev=Image.new("RGBA",(900,450),(255,255,255,255))
d=ImageDraw.Draw(prev); d.rectangle((450,0,900,450),fill=(40,40,40,255))
big=sq.resize((380,380),Image.LANCZOS)
prev.paste(big,(35,35),big); prev.paste(big,(485,35),big)
prev.save(S+"/anteprima2.png")
