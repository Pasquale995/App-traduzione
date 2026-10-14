import math, json, sys
out = sys.argv[1]
def f(x): return f"{x:.1f}".rstrip('0').rstrip('.')
def circle(cx, cy, r):
    return f"M{f(cx-r)},{f(cy)}a{f(r)},{f(r)} 0 1,0 {f(2*r)},0a{f(r)},{f(r)} 0 1,0 {f(-2*r)},0z"
def blob(cx, cy, rx, ry, rot, bumps, amp, n=90, taper=0.0):
    pts=[]
    for i in range(n):
        t=2*math.pi*i/n
        k=1+amp*(0.6*math.sin(bumps*t)+0.4*math.sin((bumps+3)*t+1.3))
        k*=1-taper*max(0.0,math.cos(t))**1.5
        x=rx*k*math.cos(t); y=ry*k*math.sin(t)
        a=math.radians(rot)
        pts.append((cx+x*math.cos(a)-y*math.sin(a), cy+x*math.sin(a)+y*math.cos(a)))
    return "M"+"L".join(f"{f(x)},{f(y)}" for x,y in pts)+"z"
# Livelli: (path, fill, stroke, strokeWidth)
L=[]
K="#1A1A1A"
# osso: nocche unite, poi il fusto, dal centro dell'aletta verso alto-sinistra, fuori dal cerchio
KN=circle(19,16,6.5)+circle(12,23,6.5)
L.append((KN, "#FFF4DC", K, 2.5))
L.append((KN, "#FFF4DC", None, 0))
L.append(("M46,52L20,26L27,20L52,45z", "#FFF4DC", K, 2.5))
L.append((circle(19,16,5.2)+circle(12,23,5.2), "#FFF4DC", None, 0))
L.append(("M24,26L46,49", None, "#E3CFA8", 1.6))
# cerchio rosso
L.insert(0, (circle(56,60,37), "#E53935", K, 3))
# aletta: corpo croccante
L.append((blob(60,66,27,18,45,10,0.06,taper=0.45), "#E39B2D", K, 3))
L.append((blob(58,63,20,11,45,8,0.07,taper=0.45), "#F6C04F", None, 0))
# grumi di panatura
for (x,y,r) in [(55,60,2.2),(64,62,1.8),(60,71,2),(70,74,1.7),(52,67,1.5),(73,66,1.5),(64,79,1.6)]:
    L.append((circle(x,y,r), "#B8701A", None, 0))
# riflesso comics
L.append(("M48,58q3,-7 11,-8", None, "#FFFFFF", 2.6))
# saetta a destra
L.append(("M98,22L87,48L96,48L84,80L107,42L97,42L106,22z", "#FFD600", K, 2.5))
# righe di velocità
L.append(("M96,64L104,62M94,72L101,71", None, K, 2))
json.dump(L, open(out+"/livelli.json","w"))
svg=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">']
for d,fill,stroke,w in L:
    svg.append(f'<path d="{d}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')
svg.append('</svg>')
open(out+"/icona.svg","w").write("\n".join(svg))
xml=['<?xml version="1.0" encoding="utf-8"?>','<!-- Mercurio: aletta di pollo fritta stile fumetto, con osso e saetta -->',
 '<vector xmlns:android="http://schemas.android.com/apk/res/android"','    android:width="108dp" android:height="108dp"','    android:viewportWidth="108" android:viewportHeight="108">']
for d,fill,stroke,w in L:
    a=[f'android:pathData="{d}"']
    if fill: a.append(f'android:fillColor="{fill}"')
    if stroke: a+= [f'android:strokeColor="{stroke}"', f'android:strokeWidth="{w}"', 'android:strokeLineJoin="round"', 'android:strokeLineCap="round"']
    xml.append("    <path\n        "+"\n        ".join(a)+" />")
xml.append("</vector>")
open(out+"/ic_launcher.xml","w").write("\n".join(xml)+"\n")
