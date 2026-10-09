# 公开接口摘要

## S1 · template/.claude/hooks/slice-gate.py
- `_ckpt_ref(change_dir, slice_id)`：快照 ref 名 `refs/flight/<change>/<S>`
- `_ckpt_delete(root, ref)`：删除快照 ref
- `_slice_owns(change_dir, slice_id)`：取切片 owns
- `_checkpoint(root)`：按文件粒度（-uall）快照 owns 内改动，无标记时静默
- `cmd_checkpoint(args)`：子命令 `checkpoint`
- `_ckpt_restore(root, ref, owns)`：把快照恢复为未提交改动
- `cmd_start(args)`：新增 `--resume-checkpoint`；首轮 start 清旧快照
- `cmd_gate(args)`：gate ok 时删快照

## S2 · template/.claude/workflows/opsx-apply.js
- `export const meta`：工作流元信息；未返回重派一次（prompt 引用 `--resume-checkpoint`），二次未返回则阻断
- 同改文件：agents/slice-executor.md、commands/opsx-apply.md、skills/openspec-apply-change/SKILL.md、hooks/hooks.json、.claude/settings.json
