import sys
from PIL import Image
S=sys.argv[1]
im=Image.open(S+"/originale.png").convert("RGB")
W,H=im.size; px=im.load(); RED=(241,8,9)
# Corner: tutto ciò che sta fuori dal quadrato arrotondato (scuro) diventa rosso,
# avanzando da ogni bordo finché non si incontra il rosso pieno.
def is_red(c): return c[0]>200 and c[1]<60 and c[2]<60
for y in range(H):
    for x0, step in ((0,1),(W-1,-1)):
        x=x0
        while 0<=x<W and not is_red(px[x,y]) and abs(x-x0)<260:
            px[x,y]=RED; x+=step
for x in range(W):
    for y0, step in ((0,1),(H-1,-1)):
        y=y0
        while 0<=y<H and not is_red(px[x,y]) and abs(y-y0)<260:
            px[x,y]=RED; y+=step
im.save(S+"/pieno.png")
# Icona adattiva: primo piano 432x432 (108dp a xxxhdpi), contenuto nella zona sicura su fondo rosso.
fg=Image.new("RGB",(432,432),RED)
inner=im.resize((300,300),Image.LANCZOS)
fg.paste(inner,(66,66))
fg.save(S+"/foreground.png")
for name,size in (("mdpi",108),("hdpi",162),("xhdpi",216),("xxhdpi",324),("xxxhdpi",432)):
    fg.resize((size,size),Image.LANCZOS).save(f"{S}/fg-{name}.png")
# anteprima: cerchio e quadrato arrotondato come li ritaglia il launcher
from PIL import ImageDraw
prev=Image.new("RGB",(900,450),(221,221,221))
for i,shape in enumerate(("circle","rounded")):
    m=Image.new("L",(400,400),0); d=ImageDraw.Draw(m)
    if shape=="circle": d.ellipse((0,0,399,399),fill=255)
    else: d.rounded_rectangle((0,0,399,399),radius=90,fill=255)
    big=fg.resize((400,400),Image.LANCZOS)
    prev.paste(big,(25+i*450,25),m)
prev.save(S+"/anteprima.png")
