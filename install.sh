#!/usr/bin/env bash
# intent-driven-claude-code installer
#
# 用法 / Usage
#   首次安装 / Install : ./install.sh [TARGET_DIR]
#   升级     / Upgrade : ./install.sh --upgrade [TARGET_DIR]
#   管道     / Pipe    : curl -fsSL <raw-url>/install.sh | bash -s -- [--upgrade] [TARGET_DIR]
#
# TARGET_DIR 缺省为当前工作目录；不存在会自动创建。
#
# 两种模式:
#   默认(install)：幂等、只增不改 —— 已存在的文件一律跳过，绝不覆盖。
#   --upgrade    ：刷新「库自有文件」(.claude/ 与 openspec/schemas/)，
#                  迁移根 adr/ → openspec/adr/，刷新 CLAUDE.md 的 intent-driven 段；
#                  「用户数据」(openspec/changes、specs、adr、superpower、config.yaml、
#                  ADR 风格 preferences.md、CLAUDE.md 正文) 一律保留不动。
#
# 退出码:
#   0  成功
#   2  参数错误
#   3  缺少 openspec CLI
#   4  复制 / 写入 / 下载失败

set -euo pipefail

# ---------------------------------------------------------------------------
# 可配置项：fork 后请把 REPO_URL 改为你自己的仓库地址，
# 这是 curl | bash 模式下载 tarball 的来源。
# 也可在调用前设置环境变量 IDT_REPO_URL 覆盖。
# ---------------------------------------------------------------------------
REPO_URL="${IDT_REPO_URL:-https://github.com/akarizo/intent-driven-claude-code}"
BRANCH="${IDT_BRANCH:-main}"

# ---------------------------------------------------------------------------
# 颜色 & 日志
# ---------------------------------------------------------------------------
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
  C_GREEN=$(tput setaf 2 2>/dev/null || true)
  C_YELLOW=$(tput setaf 3 2>/dev/null || true)
  C_BLUE=$(tput setaf 4 2>/dev/null || true)
  C_RED=$(tput setaf 1 2>/dev/null || true)
  C_DIM=$(tput dim 2>/dev/null || true)
  C_RESET=$(tput sgr0 2>/dev/null || true)
else
  C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_RED=""; C_DIM=""; C_RESET=""
fi

log_add()  { printf '%s[add]%s     %s\n' "$C_GREEN"  "$C_RESET" "$1"; }
log_upd()  { printf '%s[update]%s  %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
log_mv()   { printf '%s[move]%s    %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
log_skip() { printf '%s[skip]%s    %s\n' "$C_DIM"    "$C_RESET" "$1"; }
log_app()  { printf '%s[append]%s  %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
log_info() { printf '%s[info]%s    %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
log_err()  { printf '%s[err]%s     %s\n' "$C_RED"    "$C_RESET" "$1" >&2; }

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
intent-driven-claude-code installer

用法:
  ./install.sh [TARGET_DIR]              # 首次安装(只增不改)
  ./install.sh --upgrade [TARGET_DIR]    # 升级(刷新库文件 + 迁移 adr)
  curl -fsSL <raw-url>/install.sh | bash -s -- [--upgrade] [TARGET_DIR]

参数:
  TARGET_DIR     目标项目根目录，缺省 \$PWD

选项:
  -u, --upgrade  升级模式：刷新 .claude/ 与 openspec/schemas/，
                 迁移根 adr/ → openspec/adr/，刷新 CLAUDE.md 段；
                 用户数据(changes/specs/adr/superpower/config/preferences/CLAUDE.md 正文)不动
  -h, --help     显示本帮助

环境变量:
  IDT_REPO_URL   pipe 模式下载 tarball 的仓库地址 (默认 $REPO_URL)
  IDT_BRANCH     pipe 模式下载的分支             (默认 $BRANCH)
EOF
}

UPGRADE=0
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    -u|--upgrade) UPGRADE=1; shift ;;
    --)           shift ;;
    -*)           log_err "未知选项: $1"; usage; exit 2 ;;
    *)
      if [[ -z "$TARGET" ]]; then TARGET="$1"; shift
      else log_err "多余参数: $1"; usage; exit 2; fi
      ;;
  esac
done
TARGET="${TARGET:-$PWD}"

# ---------------------------------------------------------------------------
# 前置检查：openspec CLI 必须存在
# ---------------------------------------------------------------------------
if ! command -v openspec >/dev/null 2>&1; then
  log_err "未检测到 openspec CLI"
  cat >&2 <<EOF

请先安装 OpenSpec CLI（任选其一）:
  npm  install -g @fission-ai/openspec
  pnpm add       -g @fission-ai/openspec
  bun  add       -g @fission-ai/openspec

随后重新运行本脚本。
EOF
  exit 3
fi

# ---------------------------------------------------------------------------
# 软前置：python3（intent-driven 门禁/提醒 hook 需要它；缺失不阻断安装，只是 hook 不生效）
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  PYTHON_OK=1
else
  PYTHON_OK=0
  log_info "未检测到 python3：intent-driven 门禁/提醒 hook 需 python3 才生效（其余功能不受影响）"
fi

# ---------------------------------------------------------------------------
# 模板源定位：本地 vs 管道
# ---------------------------------------------------------------------------
MODE="local"
TEMPLATE_SRC=""
CLEANUP_TMP=""

src_file="${BASH_SOURCE[0]:-}"
if [[ -n "$src_file" && -f "$src_file" ]]; then
  SCRIPT_DIR=$(cd "$(dirname "$src_file")" && pwd)
  if [[ -d "$SCRIPT_DIR/template" ]]; then
    TEMPLATE_SRC="$SCRIPT_DIR/template"
  fi
fi

if [[ -z "$TEMPLATE_SRC" ]]; then
  MODE="pipe"
  command -v curl >/dev/null 2>&1 || { log_err "pipe 模式需要 curl"; exit 4; }
  command -v tar  >/dev/null 2>&1 || { log_err "pipe 模式需要 tar";  exit 4; }
  TMP=$(mktemp -d)
  CLEANUP_TMP="$TMP"
  trap 'rm -rf "$CLEANUP_TMP"' EXIT
  log_info "pipe 模式：下载 $REPO_URL@$BRANCH"
  if ! curl -fsSL "$REPO_URL/archive/refs/heads/$BRANCH.tar.gz" \
       | tar -xz -C "$TMP" --strip-components=1; then
    log_err "下载或解压失败：$REPO_URL@$BRANCH"
    exit 4
  fi
  TEMPLATE_SRC="$TMP/template"
fi

[[ -d "$TEMPLATE_SRC" ]] || { log_err "找不到模板目录: $TEMPLATE_SRC"; exit 4; }

# ---------------------------------------------------------------------------
# 目标准备
# ---------------------------------------------------------------------------
if [[ ! -e "$TARGET" ]]; then
  log_info "目标不存在，自动创建: $TARGET"
  mkdir -p "$TARGET"
fi
[[ -d "$TARGET" ]] || { log_err "目标不是目录: $TARGET"; exit 2; }
TARGET=$(cd "$TARGET" && pwd)

log_info "模板来源: $TEMPLATE_SRC  (模式: $MODE)"
log_info "安装到  : $TARGET"
if [[ "$UPGRADE" == 1 ]]; then
  log_info "运行模式: 升级 (刷新库文件 + 迁移 adr；用户数据保留)"
else
  log_info "运行模式: 安装 (只增不改)"
fi
echo

# ---------------------------------------------------------------------------
# 计数
# ---------------------------------------------------------------------------
ADD_COUNT=0
SKIP_COUNT=0
UPD_COUNT=0
MOVE_COUNT=0

# ---------------------------------------------------------------------------
# 幂等复制：BSD/GNU 双兼容；统计在循环外维护
#   注意：用 process substitution 而非 pipe，以便 while 体里能修改外层变量
#   $3 overwrite=1 时覆盖已存在文件(升级用)；$4 preserve 命中的 basename 永不覆盖
# ---------------------------------------------------------------------------
copy_tree() {
  local src="$1" dst="$2" overwrite="${3:-0}" preserve="${4:-}" rel out base
  [[ -d "$src" ]] || return 0
  while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    [[ -z "$rel" || "$rel" == "." ]] && continue
    out="$dst/$rel"
    if [[ -d "$src/$rel" ]]; then
      mkdir -p "$out"
    elif [[ -e "$out" ]]; then
      base="$(basename "$rel")"
      if [[ "$overwrite" == 1 && ( -z "$preserve" || "$base" != "$preserve" ) ]]; then
        cp "$src/$rel" "$out"
        log_upd "${out#$TARGET/}"
        UPD_COUNT=$((UPD_COUNT+1))
      else
        log_skip "${out#$TARGET/}"
        SKIP_COUNT=$((SKIP_COUNT+1))
      fi
    else
      mkdir -p "$(dirname "$out")"
      cp "$src/$rel" "$out"
      log_add "${out#$TARGET/}"
      ADD_COUNT=$((ADD_COUNT+1))
    fi
  done < <(cd "$src" && find . \( -type d -o -type f \) -print0)
}

# ---------------------------------------------------------------------------
# 一次性迁移：根 adr/*.md → openspec/adr/（仅升级模式调用）
#   碰到目标同名文件则跳过、保留根文件待人工核对；迁完若根 adr/ 只剩 .gitkeep 则删空
# ---------------------------------------------------------------------------
migrate_root_adr() {
  local old="$TARGET/adr" new="$TARGET/openspec/adr" f base leftover
  [[ -d "$old" ]] || return 0
  mkdir -p "$new"
  shopt -s nullglob
  for f in "$old"/*.md; do
    base="$(basename "$f")"
    if [[ -e "$new/$base" ]]; then
      log_skip "openspec/adr/$base (目标已存在，根 adr/$base 保留待人工核对)"
    else
      mv "$f" "$new/$base"
      log_mv "adr/$base → openspec/adr/$base"
      MOVE_COUNT=$((MOVE_COUNT+1))
    fi
  done
  shopt -u nullglob
  leftover="$(ls -A "$old" 2>/dev/null | grep -v '^\.gitkeep$' || true)"
  if [[ -z "$leftover" ]]; then
    rm -f "$old/.gitkeep"
    rmdir "$old" 2>/dev/null && log_mv "移除空目录 adr/" || true
  else
    log_info "根 adr/ 仍有非 ADR 内容，保留目录待人工处理: $leftover"
  fi
}

# ---------------------------------------------------------------------------
# CLAUDE.md 的 intent-driven 段：升级时整段替换 marker 之间内容（保留段外正文）
# ---------------------------------------------------------------------------
refresh_marker_block() {
  local file="$1" snip="$2" tmp
  tmp="$(mktemp)"
  if awk -v snip="$snip" -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
        function emit(   l){ while((getline l < snip)>0) print l; close(snip) }
        $0==b { emit(); skip=1; next }
        skip && $0==e { skip=0; next }
        skip { next }
        { print }
      ' "$file" > "$tmp"; then
    mv "$tmp" "$file"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# ---------------------------------------------------------------------------
# settings.json hooks 合并：把 .claude/hooks/hooks.json 的 hooks 幂等并入目标 settings.json
#   settings.json 属用户数据，绝不 copy_tree 覆盖——故 hooks 配置以独立 fragment 下发再合并
#   按 command 串去重，保留用户其余 key；install / upgrade 都跑；缺 python3 则打印手动指引
# ---------------------------------------------------------------------------
merge_settings() {
  local settings="$TARGET/.claude/settings.json"
  local fragment="$TARGET/.claude/hooks/hooks.json"
  [[ -f "$fragment" ]] || return 0
  if [[ "${PYTHON_OK:-0}" != 1 ]]; then
    log_info ".claude/settings.json: 无 python3，跳过 hooks 自动合并（门禁/提醒暂不生效）"
    log_info "  手动：把 .claude/hooks/hooks.json 的 hooks 节并入 .claude/settings.json"
    return 0
  fi
  local status
  status=$(python3 - "$settings" "$fragment" <<'PY'
import json, os, sys
settings_path, fragment_path = sys.argv[1], sys.argv[2]
with open(fragment_path, encoding="utf-8") as f:
    frag = json.load(f)
existed = os.path.isfile(settings_path)
if existed:
    try:
        with open(settings_path, encoding="utf-8") as f:
            data = json.load(f)
    except (ValueError, OSError):
        print("error_malformed"); sys.exit(0)   # 解析失败 → 中止, 绝不覆盖用户内容
    if not isinstance(data, dict):
        print("error_malformed"); sys.exit(0)   # 已存在但非 JSON 对象 → 同样中止
else:
    data = {}
hooks = data.setdefault("hooks", {})

def key(entry):
    return tuple(h.get("command") for h in entry.get("hooks", []))

changed = False
for event, entries in frag.get("hooks", {}).items():
    bucket = hooks.setdefault(event, [])
    seen = {key(e) for e in bucket}
    for e in entries:
        if key(e) not in seen:
            bucket.append(e)
            seen.add(key(e))
            changed = True

if not existed:
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("created")
elif changed:
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("merged")
else:
    print("unchanged")
PY
) || { log_err ".claude/settings.json 合并失败（hooks 未注入）"; return 0; }
  case "$status" in
    created)   log_add ".claude/settings.json (注入 intent-driven hooks)"; ADD_COUNT=$((ADD_COUNT+1)) ;;
    merged)    log_upd ".claude/settings.json (合并 intent-driven hooks)"; UPD_COUNT=$((UPD_COUNT+1)) ;;
    unchanged)       log_skip ".claude/settings.json (hooks 已在, 跳过)"; SKIP_COUNT=$((SKIP_COUNT+1)) ;;
    error_malformed) log_err  ".claude/settings.json 非法 JSON 或非对象，已跳过 hooks 合并以免覆盖你的内容；请修复后重跑 install" ;;
    *)               log_info ".claude/settings.json: $status" ;;
  esac
}

# ---------------------------------------------------------------------------
# 复制：库自有文件 vs 用户数据
# ---------------------------------------------------------------------------
# .claude/：库代码，升级时刷新（但保留用户的 ADR 风格 preferences.md）
copy_tree "$TEMPLATE_SRC/.claude"  "$TARGET/.claude"  "$UPGRADE" "preferences.md"
# openspec/：用户数据 + 种子目录，绝不覆盖
copy_tree "$TEMPLATE_SRC/openspec" "$TARGET/openspec" 0
# openspec/schemas/：库自有 schema，升级时刷新；同时迁移根 adr/
if [[ "$UPGRADE" == 1 ]]; then
  copy_tree "$TEMPLATE_SRC/openspec/schemas" "$TARGET/openspec/schemas" 1
  migrate_root_adr
fi

# ---------------------------------------------------------------------------
# settings.json：合并 intent-driven hooks（门禁 intent-gate + 提醒 intent-reminder）
# ---------------------------------------------------------------------------
merge_settings

# ---------------------------------------------------------------------------
# CLAUDE.md 注入 (marker 包裹，幂等；升级时刷新段内内容)
# ---------------------------------------------------------------------------
SNIPPET="$TEMPLATE_SRC/CLAUDE.md.snippet"
TARGET_CLAUDE="$TARGET/CLAUDE.md"
MARKER_BEGIN="<!-- intent-driven:begin -->"
MARKER_END="<!-- intent-driven:end -->"

[[ -f "$SNIPPET" ]] || { log_err "缺失 CLAUDE.md.snippet: $SNIPPET"; exit 4; }

if [[ ! -f "$TARGET_CLAUDE" ]]; then
  cp "$SNIPPET" "$TARGET_CLAUDE"
  log_add "CLAUDE.md"
  ADD_COUNT=$((ADD_COUNT+1))
elif grep -qF "$MARKER_BEGIN" "$TARGET_CLAUDE"; then
  if [[ "$UPGRADE" == 1 ]]; then
    if grep -qF "$MARKER_END" "$TARGET_CLAUDE" && refresh_marker_block "$TARGET_CLAUDE" "$SNIPPET"; then
      log_upd "CLAUDE.md  (刷新 intent-driven 段)"
      UPD_COUNT=$((UPD_COUNT+1))
    else
      log_skip "CLAUDE.md  (marker 不完整，未自动刷新，请人工核对)"
      SKIP_COUNT=$((SKIP_COUNT+1))
    fi
  else
    log_skip "CLAUDE.md  (已含 intent-driven 段，跳过)"
    SKIP_COUNT=$((SKIP_COUNT+1))
  fi
else
  {
    printf '\n\n'
    cat "$SNIPPET"
  } >> "$TARGET_CLAUDE"
  log_app "CLAUDE.md  (追加 intent-driven 段)"
fi

# ---------------------------------------------------------------------------
# .gitignore：确保每 change 的 .worktrees/ 被忽略 (幂等；仅在已有 .gitignore 时追加)
# 新规则「每 change 一个 worktree」会在项目根产生 .worktrees/，其内容各自跟踪
# worktree-<change> 分支，不该作为主仓库未跟踪噪音出现在 git status。
# ---------------------------------------------------------------------------
TARGET_GITIGNORE="$TARGET/.gitignore"
if [[ -f "$TARGET_GITIGNORE" ]]; then
  if grep -qE '^\.worktrees/?$' "$TARGET_GITIGNORE"; then
    log_skip ".gitignore (.worktrees/ 已忽略, 跳过)"
    SKIP_COUNT=$((SKIP_COUNT+1))
  else
    printf '\n# Intent-driven per-change worktrees (每 change 一间；内容各自跟踪 worktree-<change> 分支)\n.worktrees/\n' >> "$TARGET_GITIGNORE"
    log_app ".gitignore (追加 .worktrees/)"
  fi
else
  log_info ".gitignore: 项目无 .gitignore，未创建；如用 git 请手动忽略 .worktrees/"
fi

# ---------------------------------------------------------------------------
# 摘要
# ---------------------------------------------------------------------------
echo
printf '%s✓ Intent-Driven 已就绪%s   [add] %d  [update] %d  [move] %d  [skip] %d\n' \
  "$C_GREEN" "$C_RESET" "$ADD_COUNT" "$UPD_COUNT" "$MOVE_COUNT" "$SKIP_COUNT"
cat <<EOF

下一步 (Next steps):
  1. cd "$TARGET"
  2. 在 Claude Code 中输入:
       /opsx-propose <change-name>     # 一次性生成 proposal/design/tasks
       /opsx-new     <change-name>     # 或：逐 artifact 推进
  3. CLI 验证:
       openspec list
       openspec schema validate intent-driven

更多:
  - 15 个 slash command 见 .claude/commands/（10 个 opsx-* 含 /opsx-mini + 3 个 claudemd-* + /spec-html + /pr-ship）
  - 17 个 skill 见 .claude/skills/（含 test-driven-development、spec-html-render、openspec-subagent-apply-change）
  - 1 个 agent 见 .claude/agents/（code-reviewer：逐 task 守门 + /pr-ship 评审共用）
  - apply 两模式：中级+ 推荐「subagent 逐 task 守门」(openspec-subagent-apply-change)，每个 task 实现完即派 code-reviewer 守门(CRITICAL/HIGH 阻断)；轻量退回串行
  - 分级门禁：中级+ 改源码前必须 /opsx-propose 建 5 工件；mini 先 /opsx-mini 留痕（hook 见 .claude/hooks/，需 python3）
  - CLAUDE.md 层级规范见 .claude/claudemd-standard.md（/claudemd-sync·/claudemd-distill 的硬约束基线）
  - schema 副本见 openspec/schemas/intent-driven/
  - Worktree 隔离：每个 change 从 propose 起在自己的 .worktrees/<change>/ (branch worktree-<change>) 里进行，工件+实现全落其中，项目根保持干净；权威见 .claude/skills/openspec-git-discipline/
  - HTML 审批面板：propose/continue 后自动出 (worktree 内) openspec/changes/<change>/spec.html
  - 落点收敛：每 change 产物落其 worktree；ADR → openspec/adr/；探索设计稿 → openspec/superpower/；项目根仅 .claude/ + openspec/ + CLAUDE.md (+ 已忽略的 .worktrees/)
  - 已装项目升级：./install.sh --upgrade（刷新库文件 + 自动迁移 adr，用户数据不动）
EOF
