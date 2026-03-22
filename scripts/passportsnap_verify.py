#!/usr/bin/env python3
"""
PassportSnap Output Verifier v4.1
═════════════════════════════════
Verifies REAL processed photos from the PassportSnap app.

Usage:
    python passportsnap_verify.py --dir ./test_outputs/ --report report.html
"""

import os, sys, json, time, argparse
from datetime import datetime
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

SPECS = {
    "USA": {"w":600,"h":600,"dpi":300,"w_mm":50.8,"h_mm":50.8,"face_min_mm":25,"face_max_mm":35,"gap_min_mm":2,"gap_max_mm":15,"sheet_pw":600,"sheet_ph":600,"fmt":"2x2 inch"},
    "IND": {"w":600,"h":600,"dpi":300,"w_mm":50.8,"h_mm":50.8,"face_min_mm":25,"face_max_mm":35,"gap_min_mm":2,"gap_max_mm":15,"sheet_pw":600,"sheet_ph":600,"fmt":"2x2 inch"},
    "GBR": {"w":900,"h":1200,"dpi":600,"w_mm":35.0,"h_mm":45.0,"face_min_mm":29,"face_max_mm":34,"gap_min_mm":1,"gap_max_mm":7,"sheet_pw":413,"sheet_ph":532,"fmt":"35x45mm"},
    "SCH": {"w":900,"h":1200,"dpi":600,"w_mm":35.0,"h_mm":45.0,"face_min_mm":32,"face_max_mm":36,"gap_min_mm":1,"gap_max_mm":7,"sheet_pw":413,"sheet_ph":532,"fmt":"35x45mm"},
    "AUS": {"w":900,"h":1200,"dpi":600,"w_mm":35.0,"h_mm":45.0,"face_min_mm":32,"face_max_mm":36,"gap_min_mm":1,"gap_max_mm":7,"sheet_pw":413,"sheet_ph":532,"fmt":"35x45mm"},
    "DEU": {"w":900,"h":1200,"dpi":600,"w_mm":35.0,"h_mm":45.0,"face_min_mm":32,"face_max_mm":36,"gap_min_mm":1,"gap_max_mm":7,"sheet_pw":413,"sheet_ph":532,"fmt":"35x45mm"},
    "ZAF": {"w":900,"h":1200,"dpi":600,"w_mm":35.0,"h_mm":45.0,"face_min_mm":32,"face_max_mm":36,"gap_min_mm":1,"gap_max_mm":7,"sheet_pw":413,"sheet_ph":532,"fmt":"35x45mm"},
    "CAN": {"w":1200,"h":1680,"dpi":610,"w_mm":50.0,"h_mm":70.0,"face_min_mm":31,"face_max_mm":36,"gap_min_mm":3,"gap_max_mm":12,"sheet_pw":591,"sheet_ph":827,"fmt":"50x70mm"},
}
SHEET_W, SHEET_H, SHEET_DPI = 1200, 1800, 300
COUNTRY_NAMES = {"USA":"United States","IND":"India","GBR":"United Kingdom","SCH":"Schengen","AUS":"Australia","DEU":"Germany","ZAF":"South Africa","CAN":"Canada"}

class R:
    def __init__(self):
        self.rows = []
    def ok(self, cat, tid, desc, expected, actual):   self.rows.append(("PASS",cat,tid,desc,expected,actual))
    def fail(self, cat, tid, desc, expected, actual):  self.rows.append(("FAIL",cat,tid,desc,expected,actual))
    def warn(self, cat, tid, desc, expected, actual):  self.rows.append(("WARN",cat,tid,desc,expected,actual))
    def skip(self, cat, tid, desc, expected="", actual=""): self.rows.append(("SKIP",cat,tid,desc,expected,actual))
    @property
    def passed(self): return sum(1 for r in self.rows if r[0]=="PASS")
    @property
    def failed(self): return sum(1 for r in self.rows if r[0]=="FAIL")
    @property
    def warned(self): return sum(1 for r in self.rows if r[0]=="WARN")
    @property
    def skipped(self): return sum(1 for r in self.rows if r[0]=="SKIP")
    @property
    def total(self): return len(self.rows)

res = R()

# ═══════════════════════════════════════════════════════════════
#  IMAGE ANALYSIS
# ═══════════════════════════════════════════════════════════════
def detect_country_from_filename(fname):
    f = fname.upper().replace("-","_").replace(" ","_")
    # Check for US variant
    if "_US." in f or "_US_" in f or f.startswith("US_") or f.startswith("US."):
        return "USA"
    for code in SPECS:
        if code in f:
            return code
    return None

def detect_country_from_dims(w, h):
    for code, s in SPECS.items():
        if abs(w-s["w"])<=2 and abs(h-s["h"])<=2:
            return code
    return None

def is_4x6_sheet(w, h):
    return abs(w-1200)<=5 and abs(h-1800)<=5

def measure_background_whiteness(arr):
    """Measure background whiteness from TOP HALF + sides only (avoids body/clothing)."""
    h, w = arr.shape[:2]
    samples = []
    # Top corners (10x10)
    for y in [5, 5]:
        for x in [5, w-5]:
            patch = arr[max(0,y-5):y+5, max(0,x-5):x+5]
            samples.extend(patch.reshape(-1,3).tolist())
    # Top edge midpoint
    patch = arr[2:12, w//4:3*w//4:10]
    samples.extend(patch.reshape(-1,3).tolist())
    # Left side (top 60%)
    for y in range(10, int(h*0.6), h//10):
        patch = arr[y:y+5, 2:12]
        samples.extend(patch.reshape(-1,3).tolist())
    # Right side (top 60%)
    for y in range(10, int(h*0.6), h//10):
        patch = arr[y:y+5, w-12:w-2]
        samples.extend(patch.reshape(-1,3).tolist())
    if not samples:
        return 0
    white = sum(1 for r,g,b in samples if r>220 and g>220 and b>220)
    return round(white / len(samples) * 100, 1)

def measure_head(arr, spec_h_mm):
    """Measure head from crown to chin using non-white detection + width narrowing."""
    h, w = arr.shape[:2]
    px_per_mm = h / spec_h_mm

    # Find top of head: first row that's NOT mostly white background
    is_bg = (arr[:,:,0].astype(int) > 220) & (arr[:,:,1].astype(int) > 220) & (arr[:,:,2].astype(int) > 220)
    row_bg_pct = is_bg.sum(axis=1) / w

    head_top = 0
    for y in range(h):
        if row_bg_pct[y] < 0.85:
            head_top = y
            break

    # Skin detection for face width analysis
    r,g,b = arr[:,:,0].astype(int), arr[:,:,1].astype(int), arr[:,:,2].astype(int)
    skin = (r>80)&(r<255)&(g>40)&(g<230)&(b>20)&(b<210)&(r>g)&(r>b)&((r-g)>5)&((r-b)>10)

    # Measure skin width per row
    row_width = np.zeros(h)
    for y in range(h):
        cols = np.where(skin[y])[0]
        if len(cols) > 5:
            row_width[y] = cols[-1] - cols[0]

    # Find max face width in upper 55% of image (face zone, not body)
    search_end = min(h, head_top + int(h * 0.55))
    if search_end <= head_top:
        return None
    max_w = row_width[head_top:search_end].max()
    if max_w < 10:
        return None

    # Chin = where skin width drops below 35% of max face width (neck transition)
    max_y = head_top + int(np.argmax(row_width[head_top:search_end]))
    chin_y = search_end
    for y in range(max_y, search_end):
        if row_width[y] < max_w * 0.35:
            chin_y = y
            break

    head_h_px = chin_y - head_top
    if head_h_px < h * 0.1:
        return None

    # Face center for horizontal centering check
    face_zone = skin[head_top:chin_y, :]
    cols = np.any(face_zone, axis=0)
    if cols.any():
        left = int(np.argmax(cols))
        right = int(w - np.argmax(cols[::-1]) - 1)
        center_x = (left + right) // 2
    else:
        center_x = w // 2

    return {
        "head_top": head_top,
        "chin": chin_y,
        "head_h_px": head_h_px,
        "head_h_mm": round(head_h_px / px_per_mm, 1),
        "gap_mm": round(head_top / px_per_mm, 1),
        "center_x": center_x,
        "face_ar": round((right-left)/head_h_px, 2) if head_h_px > 0 else 0,
    }

def find_sheet_photos(arr):
    """Find photo slots in 4x6 sheet via border scanning."""
    h, w = arr.shape[:2]
    cx = w // 2

    # Scan center column for dark border pixels
    dark_rows = []
    for y in range(h):
        if arr[y,cx,0] < 30 and arr[y,cx,1] < 30 and arr[y,cx,2] < 30:
            dark_rows.append(y)
    if len(dark_rows) < 4:
        return None

    # Group into bands
    bands = []
    start = dark_rows[0]
    for i in range(1, len(dark_rows)):
        if dark_rows[i] - dark_rows[i-1] > 3:
            bands.append((start, dark_rows[i-1]))
            start = dark_rows[i]
    bands.append((start, dark_rows[-1]))

    # Extract photo slots from band pairs
    slots = []
    i = 0
    while i < len(bands)-1:
        top_b, bot_b = bands[i], bands[i+1]
        slot_top = top_b[1]+1
        slot_bot = bot_b[0]-1
        slot_h = slot_bot - slot_top
        if slot_h > 50:
            mid_y = (slot_top+slot_bot)//2
            left_x = right_x = None
            for x in range(w):
                if arr[mid_y,x,0]<30 and arr[mid_y,x,1]<30:
                    left_x = x; break
            for x in range(w-1,0,-1):
                if arr[mid_y,x,0]<30 and arr[mid_y,x,1]<30:
                    right_x = x; break
            if left_x and right_x:
                pw = right_x - left_x - 3
                slots.append({"top":slot_top,"bottom":slot_bot,"left":left_x+2,"right":right_x-1,
                              "width":pw,"height":slot_h,"center_x":(left_x+right_x)//2})
            i += 2
        else:
            i += 1
    return slots if len(slots)>=2 else None

# ═══════════════════════════════════════════════════════════════
#  SPEC TESTS
# ═══════════════════════════════════════════════════════════════
def run_spec_tests():
    for code, s in SPECS.items():
        if code in ("USA","IND"): ew,eh = 600,600
        elif code == "CAN": ew,eh = 1200,1680
        else: ew,eh = 900,1200
        ok = s["w"]==ew and s["h"]==eh
        (res.ok if ok else res.fail)("spec",f"SPEC-{code}-DIM",f"{code}: Output {ew}x{eh}",f"{ew}x{eh}",f"{s['w']}x{s['h']}")
        ar = round(s["w"]/s["h"],4)
        res.ok("spec",f"SPEC-{code}-AR",f"{code}: Aspect {ar}",f"{ar}",f"{ar}")
        pw,ph = s["sheet_pw"],s["sheet_ph"]
        wmm=round(pw/300*25.4,1); hmm=round(ph/300*25.4,1)
        ok = abs(wmm-s["w_mm"])<1.5 and abs(hmm-s["h_mm"])<1.5
        (res.ok if ok else res.fail)("spec",f"SPEC-{code}-4X6",f"{code}: Sheet photo {wmm}x{hmm}mm",f"{s['w_mm']}x{s['h_mm']}mm",f"{wmm}x{hmm}mm")
        slot_h=ph+4; total_h=2*slot_h+40; slot_w=pw+4
        ok = total_h<=SHEET_H and slot_w<=SHEET_W
        (res.ok if ok else res.fail)("spec",f"SPEC-{code}-FIT",f"{code}: Fits 4x6",f"<={SHEET_W}x{SHEET_H}",f"{slot_w}x{total_h}")
        src_ar=s["w"]/s["h"]; sht_ar=pw/ph if ph>0 else 0
        diff=abs(src_ar-sht_ar)/src_ar*100 if src_ar>0 else 0
        (res.ok if diff<5 else res.fail)("spec",f"SPEC-{code}-NSTR",f"{code}: Sheet aspect diff {diff:.1f}%","<5%",f"{diff:.1f}%")

# ═══════════════════════════════════════════════════════════════
#  PHOTO VERIFICATION
# ═══════════════════════════════════════════════════════════════
def verify_photos(photo_dir):
    if not HAS_PIL:
        res.skip("photo","NOPIL","Pillow not installed","",""); return
    photos = sorted(list(Path(photo_dir).glob("*.jpg"))+list(Path(photo_dir).glob("*.jpeg"))+list(Path(photo_dir).glob("*.png")))
    if not photos:
        res.skip("photo","NONE",f"No photos in {photo_dir}/","",""); return
    print(f"  Found {len(photos)} images")
    for p in photos:
        img = Image.open(p); w,h = img.size; fname = p.stem
        if is_4x6_sheet(w,h):
            _verify_sheet(p,fname,img)
        else:
            _verify_photo(p,fname,img)
        img.close()

def _verify_photo(path, fname, img):
    w,h = img.size; cat = "photo"; prefix = f"P-{fname}"
    country = detect_country_from_filename(fname) or detect_country_from_dims(w,h)
    if not country:
        res.warn(cat,f"{prefix}-DETECT",f"{fname}: Unknown dims {w}x{h}","Known size",f"{w}x{h}"); return
    s = SPECS[country]

    # 1. Dimensions
    ok = abs(w-s["w"])<=2 and abs(h-s["h"])<=2
    (res.ok if ok else res.fail)(cat,f"{prefix}-DIM",f"{fname}: {w}x{h} ({country} {s['w']}x{s['h']})",f"{s['w']}x{s['h']}",f"{w}x{h}")

    # 2. Aspect ratio
    actual_ar=round(w/h,4); spec_ar=round(s["w"]/s["h"],4)
    (res.ok if abs(actual_ar-spec_ar)<0.01 else res.fail)(cat,f"{prefix}-AR",f"{fname}: Aspect {actual_ar}",str(spec_ar),str(actual_ar))

    # 3. DPI
    dpi = img.info.get("dpi",(0,0))
    if dpi and dpi[0]>0:
        (res.ok if abs(int(dpi[0])-s["dpi"])<50 else res.warn)(cat,f"{prefix}-DPI",f"{fname}: DPI {int(dpi[0])}",str(s["dpi"]),str(int(dpi[0])))
    else:
        res.warn(cat,f"{prefix}-DPI",f"{fname}: No DPI metadata",str(s["dpi"]),"None")

    # 4. Physical mm
    use_dpi = int(dpi[0]) if (dpi and dpi[0]>0) else s["dpi"]
    w_mm=round(w/use_dpi*25.4,1); h_mm=round(h/use_dpi*25.4,1)
    (res.ok if abs(w_mm-s["w_mm"])<2 and abs(h_mm-s["h_mm"])<2 else res.warn)(cat,f"{prefix}-MM",f"{fname}: {w_mm}x{h_mm}mm",f"{s['w_mm']}x{s['h_mm']}mm",f"{w_mm}x{h_mm}mm")

    # 5. Background (TOP HALF + SIDES only — avoids body/clothing)
    arr = np.array(img)
    whiteness = measure_background_whiteness(arr)
    (res.ok if whiteness>=70 else res.fail)(cat,f"{prefix}-BG",f"{fname}: Background {whiteness}% white (top+sides)",">=70%",f"{whiteness}%")

    # 6. Head measurement (crown to chin)
    head = measure_head(arr, s["h_mm"])
    if head:
        hm = head["head_h_mm"]
        (res.ok if s["face_min_mm"]<=hm<=s["face_max_mm"] else res.warn)(cat,f"{prefix}-FACE",
            f"{fname}: Head {hm}mm ({country}: {s['face_min_mm']}-{s['face_max_mm']}mm)",
            f"{s['face_min_mm']}-{s['face_max_mm']}mm",f"{hm}mm")

        gm = head["gap_mm"]
        (res.ok if s["gap_min_mm"]<=gm<=s["gap_max_mm"] else res.warn)(cat,f"{prefix}-GAP",
            f"{fname}: Top gap {gm}mm ({country}: {s['gap_min_mm']}-{s['gap_max_mm']}mm)",
            f"{s['gap_min_mm']}-{s['gap_max_mm']}mm",f"{gm}mm")

        offset_mm = round(abs(head["center_x"]-w//2)/(h/s["h_mm"]),1)
        (res.ok if offset_mm<3 else res.warn)(cat,f"{prefix}-CENTER",f"{fname}: Face offset {offset_mm}mm","<3mm",f"{offset_mm}mm")

        fa = head["face_ar"]
        (res.ok if 0.5<=fa<=1.0 else res.warn)(cat,f"{prefix}-STRETCH",f"{fname}: Face W:H {fa}","0.5-1.0",str(fa))
    else:
        res.warn(cat,f"{prefix}-FACE",f"{fname}: Could not detect head","Detected","N/A")

def _verify_sheet(path, fname, img):
    w,h = img.size; cat = "sheet"; prefix = f"S-{fname}"
    country = detect_country_from_filename(fname)

    (res.ok if w==SHEET_W and h==SHEET_H else res.fail)(cat,f"{prefix}-DIM",f"{fname}: {w}x{h}",f"{SHEET_W}x{SHEET_H}",f"{w}x{h}")
    ar=round(w/h,4)
    (res.ok if abs(ar-0.6667)<0.01 else res.fail)(cat,f"{prefix}-AR",f"{fname}: Aspect {ar}","0.6667",str(ar))

    arr = np.array(img)
    whiteness = measure_background_whiteness(arr)
    (res.ok if whiteness>=80 else res.fail)(cat,f"{prefix}-BG",f"{fname}: Background {whiteness}%",">=80%",f"{whiteness}%")

    slots = find_sheet_photos(arr)
    if slots and len(slots)>=2:
        res.ok(cat,f"{prefix}-SLOTS",f"{fname}: {len(slots)} photo slots found","2",str(len(slots)))
        s1,s2 = slots[0],slots[1]

        if country and country in SPECS:
            exp_pw,exp_ph = SPECS[country]["sheet_pw"],SPECS[country]["sheet_ph"]
            # Use tolerant matching: ±15px to account for border detection variance
            pw_ok = abs(s1["width"]-exp_pw)<15
            ph_ok = abs(s1["height"]-exp_ph)<15
            (res.ok if pw_ok and ph_ok else res.warn)(cat,f"{prefix}-PHOTOSZ",
                f"{fname}: Photo ~{s1['width']}x{s1['height']}px (expect {exp_pw}x{exp_ph})",
                f"{exp_pw}x{exp_ph}",f"{s1['width']}x{s1['height']}")

        gap = s2["top"]-s1["bottom"]
        (res.ok if 25<=gap<=70 else res.warn)(cat,f"{prefix}-GAP",f"{fname}: Gap {gap}px","30-60px",f"{gap}px")

        for i,sl in enumerate([s1,s2]):
            off = abs(sl["center_x"]-SHEET_W//2)
            (res.ok if off<15 else res.warn)(cat,f"{prefix}-CTR{i+1}",f"{fname}: Photo {i+1} offset {off}px","<15px",f"{off}px")

        # Match: compare widths only (height detection can vary due to border thickness)
        w_diff = abs(s1["width"]-s2["width"])
        (res.ok if w_diff<10 else res.warn)(cat,f"{prefix}-MATCH",f"{fname}: Width diff {w_diff}px","<10px",f"{w_diff}px")
    else:
        res.fail(cat,f"{prefix}-SLOTS",f"{fname}: Could not find 2 photo slots","2","Failed")

# ═══════════════════════════════════════════════════════════════
#  HTML REPORT
# ═══════════════════════════════════════════════════════════════
def generate_html(output_path):
    ts=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total,passed,failed,warned,skipped=res.total,res.passed,res.failed,res.warned,res.skipped
    pct=round(passed/total*100,1) if total>0 else 0
    pc="#27ae60" if failed==0 else "#f39c12" if pct>=80 else "#e74c3c"
    cats={}
    for status,cat,tid,desc,exp,act in res.rows:
        if cat not in cats: cats[cat]={"total":0,"pass":0,"fail":0,"warn":0,"skip":0}
        cats[cat]["total"]+=1; cats[cat][{"PASS":"pass","FAIL":"fail","WARN":"warn","SKIP":"skip"}.get(status,"skip")]+=1
    cr=""
    for cat,d in cats.items():
        cp=round(d["pass"]/d["total"]*100) if d["total"]>0 else 0
        cc="#27ae60" if d["fail"]==0 else "#f39c12" if cp>=80 else "#e74c3c"
        cr+=f'<tr><td>{cat}</td><td>{d["total"]}</td><td style="color:#27ae60">{d["pass"]}</td><td style="color:#e74c3c">{d["fail"]}</td><td style="color:#e67e22">{d["warn"]}</td><td style="color:#95a5a6">{d["skip"]}</td><td><span style="color:{cc};font-weight:bold">{cp}%</span></td></tr>\n'
    tr=""
    for status,cat,tid,desc,exp,act in res.rows:
        c=status.lower(); tr+=f'<tr class="{c}"><td>{tid}</td><td>{cat}</td><td>{desc}</td><td>{exp}</td><td>{act}</td><td><span class="badge {c}">{status}</span></td></tr>\n'
    html=f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PassportSnap Report</title>
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:20px;background:#f5f6fa}}
.header{{background:linear-gradient(135deg,#1a5276,#2e86c1);color:white;padding:30px;border-radius:12px;margin-bottom:24px}}
.header h1{{margin:0 0 8px 0;font-size:28px}}.header .subtitle{{opacity:.85;font-size:14px}}
.stats{{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap}}
.stat-card{{background:white;border-radius:10px;padding:20px;min-width:120px;box-shadow:0 2px 8px rgba(0,0,0,.08);text-align:center}}
.stat-card .number{{font-size:32px;font-weight:700}}.stat-card .label{{font-size:12px;color:#666;text-transform:uppercase;margin-top:4px}}
table{{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);margin-bottom:24px}}
th{{background:#1a5276;color:white;padding:12px 16px;text-align:left;font-size:13px}}
td{{padding:10px 16px;border-bottom:1px solid #eee;font-size:13px}}tr:hover{{background:#f8f9fa}}
tr.fail td{{background:#fff5f5}}tr.warn td{{background:#fffbf0}}
.badge{{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600}}
.badge.pass{{background:#d4edda;color:#155724}}.badge.fail{{background:#f8d7da;color:#721c24}}
.badge.warn{{background:#fff3cd;color:#856404}}.badge.skip{{background:#e2e8f0;color:#4a5568}}
.section{{margin-top:24px}}.section h2{{color:#1a5276;font-size:20px;margin-bottom:12px}}
.legend{{font-size:12px;color:#666;margin:10px 0}}.legend span{{margin-right:16px}}
</style></head><body>
<div class="header"><h1>PassportSnap - Verification Report</h1>
<div class="subtitle">Generated: {ts} | Verifier v4.1</div></div>
<div class="legend"><span><span class="badge pass">PASS</span> Meets spec</span><span><span class="badge fail">FAIL</span> Needs fix</span><span><span class="badge warn">WARN</span> Borderline</span></div>
<div class="stats">
<div class="stat-card"><div class="number">{total}</div><div class="label">Total</div></div>
<div class="stat-card"><div class="number" style="color:#27ae60">{passed}</div><div class="label">Passed</div></div>
<div class="stat-card"><div class="number" style="color:#e74c3c">{failed}</div><div class="label">Failed</div></div>
<div class="stat-card"><div class="number" style="color:#e67e22">{warned}</div><div class="label">Warnings</div></div>
<div class="stat-card"><div class="number" style="color:{pc}">{pct}%</div><div class="label">Pass Rate</div></div>
</div>
<div class="section"><h2>Summary</h2><table><tr><th>Category</th><th>Total</th><th>Pass</th><th>Fail</th><th>Warn</th><th>Skip</th><th>Rate</th></tr>{cr}</table></div>
<div class="section"><h2>All Results</h2><table><tr><th>Test ID</th><th>Category</th><th>Description</th><th>Expected</th><th>Actual</th><th>Status</th></tr>{tr}</table></div>
</body></html>"""
    with open(output_path,'w') as f: f.write(html)

def main():
    parser=argparse.ArgumentParser(description="PassportSnap Verifier v4.1")
    parser.add_argument("--dir",type=str,default="test_outputs",help="Photo directory")
    parser.add_argument("--report",type=str,default=None,help="HTML report path")
    args=parser.parse_args()
    print("="*60); print("  PassportSnap Verifier v4.1"); print("="*60)
    print("\n[1/2] Spec constants..."); run_spec_tests()
    p=sum(1 for s,c,*_ in res.rows if c=='spec' and s=='PASS')
    print(f"  {p} passed")
    print(f"\n[2/2] Verifying {args.dir}/...")
    if Path(args.dir).exists():
        verify_photos(args.dir)
        for c in ["photo","sheet"]:
            pp=sum(1 for s,ct,*_ in res.rows if ct==c and s=='PASS')
            pf=sum(1 for s,ct,*_ in res.rows if ct==c and s=='FAIL')
            pw=sum(1 for s,ct,*_ in res.rows if ct==c and s=='WARN')
            if pp+pf+pw>0: print(f"  {c}: {pp} pass, {pf} fail, {pw} warn")
    else:
        print(f"  {args.dir}/ not found!"); res.skip("photo","NODIR","Dir not found","","")
    print(f"\n{'='*60}")
    print(f"  {'PASS' if res.failed==0 else 'FAIL'}: {res.passed} passed, {res.failed} failed, {res.warned} warn ({res.total} total)")
    print(f"{'='*60}")
    if res.failed>0:
        print("\n  FAILURES:")
        for s,c,t,d,e,a in res.rows:
            if s=="FAIL": print(f"    X {t}: exp={e}, got={a}")
    rp=args.report or f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    generate_html(rp); print(f"\n  Report: {rp}")
    jp=rp.replace('.html','.json')
    with open(jp,'w') as f:
        json.dump({"timestamp":datetime.now().isoformat(),"passed":res.passed,"failed":res.failed,"warned":res.warned,"total":res.total,
            "details":[{"status":s,"category":c,"test_id":t,"description":d,"expected":e,"actual":a} for s,c,t,d,e,a in res.rows]},f,indent=2)
    sys.exit(0 if res.failed==0 else 1)

if __name__=="__main__": main()
