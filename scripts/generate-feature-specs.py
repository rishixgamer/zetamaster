#!/usr/bin/env python3
"""Regenerate the Markdown feature matrix from authoritative specs/features.json."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
spec=json.loads((root/'specs/features.json').read_text())
features=spec['features']
assert len(features)==spec['featureCount']==55
assert len({x['id'] for x in features})==55
lines=['# Complete Feature Matrix (F01–F55)','',"The 55 entries below correspond to every numbered product feature in the brainstorm. `implemented` means a basic feature is usable—not that it has passed a competitive training effectiveness study. `partial` identifies working building blocks and clearly missing capabilities. `planned` is specification only.",'', '| ID | Feature | Status | Module | Minimum acceptance criterion |','|---|---|---|---|---|']
for x in features:
    assert x['status'] in ('implemented','partial','planned')
    lines.append(f"| {x['id']} | {x['title']} | {x['status']} | `{x['owner']}` | {x['acceptance'][0]} |")
lines += ['', 'See `specs/features.json` for machine-readable records. Any future `partial`/`planned` entry should become a tracked GitHub issue so it cannot silently masquerade as done. No placeholder UI buttons are presented as working functionality.', '']
(root/'docs/FEATURE_MATRIX.md').write_text('\n'.join(lines))
print('Regenerated',len(features),'feature rows')
