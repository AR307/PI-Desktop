"""Regenerate Android launcher and splash assets from the PI desktop icon."""
from pathlib import Path
from PIL import Image

mobile = Path(__file__).resolve().parents[1]
source = Image.open(mobile.parent / "desktop" / "build" / "icon.png").convert("RGBA")
resources = mobile / "android" / "app" / "src" / "main" / "res"
for density, size in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    folder = resources / f"mipmap-{density}"
    source.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher.png")
    source.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher_round.png")
    canvas = Image.new("RGBA", (size * 3, size * 3))
    icon = source.resize((size * 2, size * 2), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, (size // 2, size // 2))
    canvas.save(folder / "ic_launcher_foreground.png")
for path in resources.glob("drawable*/splash.png"):
    with Image.open(path) as previous:
        width, height = previous.size
    canvas = Image.new("RGBA", (width, height), "#181818")
    edge = max(48, min(width, height) // 4)
    icon = source.resize((edge, edge), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, ((width - edge) // 2, (height - edge) // 2))
    canvas.convert("RGB").save(path)
