#!/usr/bin/env python3
"""Sinh manifest.json (cùng định dạng git tree của GitHub API) cho app đọc trực tiếp từ GitHub Pages."""
import subprocess, json, hashlib

raw = subprocess.check_output(["git", "ls-tree", "-r", "-t", "-l", "-z", "HEAD"]).decode("utf-8")
SKIP_TOP = {".git", ".github", "node_modules"}
tree = []
for rec in raw.split("\0"):
    if not rec:
        continue
    meta, path = rec.split("\t", 1)
    _mode, typ, sha, size = meta.split()
    if typ not in ("blob", "tree"):
        continue
    if path.split("/")[0] in SKIP_TOP or path == "manifest.json":
        continue
    tree.append({"path": path, "type": typ, "sha": sha, "size": 0 if size == "-" else int(size)})

digest = hashlib.sha1("\n".join(e["path"] + e["sha"] for e in tree).encode("utf-8")).hexdigest()
with open("manifest.json", "w", encoding="utf-8") as f:
    json.dump({"sha": digest, "count": len(tree), "tree": tree}, f, ensure_ascii=False, separators=(",", ":"))
print("manifest.json:", len(tree), "entries")
