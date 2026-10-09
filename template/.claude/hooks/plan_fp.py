#!/usr/bin/env python3
# plan_fp · OpenSpec change 的计划指纹（零 token 纯函数判定器，design D1）
#
# CLI:
#   plan_fp.py --change-dir DIR [--short]
#     exit 0：stdout 一行指纹（64 位小写十六进制；--short 为前 8 位）
#     exit 2：目录不存在 / 无计划文件 → stderr 一行原因
#
# 白名单 PLAN_FILES = proposal.md · design.md · slices.json · specs/**/spec.md · slices/*.md（除 slices/_interfaces.md）。
# 其余文件（tasks.md 勾选、spec.html、timeline、gate 报告、evidence 等执行记录）一律不读。
# slices.json 规范化时删去 gate.full_suite_sec（实测耗时，基线会改写）；所有文本 CRLF → LF。
# 兼容 Python 3.8+，只用标准库。
import argparse
import glob
import hashlib
import json
import os
import sys

INTERFACES = "slices/_interfaces.md"


class PlanError(Exception):
    pass


def plan_files(change_dir):
    """返回白名单内实际存在的计划文件相对路径（用 / 分隔，已排序）。"""
    rels = set()
    for name in ("proposal.md", "design.md", "slices.json"):
        if os.path.isfile(os.path.join(change_dir, name)):
            rels.add(name)
    for path in glob.glob(os.path.join(glob.escape(change_dir), "specs", "**", "spec.md"), recursive=True):
        if os.path.isfile(path):
            rels.add(os.path.relpath(path, change_dir).replace(os.sep, "/"))
    for path in glob.glob(os.path.join(glob.escape(change_dir), "slices", "*.md")):
        rel = os.path.relpath(path, change_dir).replace(os.sep, "/")
        if os.path.isfile(path) and rel != INTERFACES:
            rels.add(rel)
    return sorted(rels)


def normalize(rel, raw):
    text = raw.decode("utf-8").replace("\r\n", "\n")
    if rel == "slices.json":
        data = json.loads(text)
        gate = data.get("gate") if isinstance(data, dict) else None
        if isinstance(gate, dict):
            gate.pop("full_suite_sec", None)
        text = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return text.encode("utf-8")


def plan_fingerprint(change_dir):
    if not os.path.isdir(change_dir):
        raise PlanError("change-dir 不存在: %s" % change_dir)
    rels = plan_files(change_dir)
    if not rels:
        raise PlanError("change-dir 内无计划文件: %s" % change_dir)
    lines = []
    for rel in rels:
        with open(os.path.join(change_dir, rel), "rb") as f:
            raw = f.read()
        try:
            body = normalize(rel, raw)
        except (UnicodeDecodeError, ValueError) as e:
            raise PlanError("计划文件无法解析 %s: %s" % (rel, e))
        lines.append("%s\t%s" % (rel, hashlib.sha256(body).hexdigest()))
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser(description="计算 OpenSpec change 的计划指纹")
    ap.add_argument("--change-dir", required=True)
    ap.add_argument("--short", action="store_true")
    args = ap.parse_args(argv)
    try:
        fp = plan_fingerprint(args.change_dir)
    except PlanError as e:
        sys.stderr.write("%s\n" % e)
        return 2
    print(fp[:8] if args.short else fp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
