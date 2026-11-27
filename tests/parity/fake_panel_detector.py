"""Stand-in for comics-panel's panel_detector.py: writes two fixed panels for any page."""
import json
import sys
from pathlib import Path

image = Path(sys.argv[1])
out = Path(sys.argv[sys.argv.index("-o") + 1])
panels = [{"bbox": [10, 20, 100, 200], "method": "region"}, {"bbox": [110, 20, 100, 200], "method": "region"}]
(out / f"{image.stem}_panels.json").write_text(json.dumps(panels), encoding="utf-8")
# The real detector logs what its model cost; both servers read it from stderr
print("x - root - INFO - LLM: 1 call(s), 0 cache hit(s), ~$0.00020 [answered by fake x1]", file=sys.stderr)
