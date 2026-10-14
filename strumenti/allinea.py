"""zipalign minimale: allinea a 4 byte i file non compressi (serve per resources.arsc)."""
import sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        new.compress_type = info.compress_type
        new.external_attr = info.external_attr
        if info.compress_type == zipfile.ZIP_STORED:
            align = 4096 if info.filename.endswith(".so") else 4
            header_end = zout.fp.tell() + 30 + len(info.filename.encode())
            new.extra = b"\0" * ((-header_end) % align)
        zout.writestr(new, data)
