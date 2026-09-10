"""memory-lint 的测试。

被测脚本 `template/.claude/hooks/memory-lint.py` 的文件名带 `-`，不是合法模块名，
故用 importlib 按路径加载（design D7）。测试落在仓库根 tests/ 而非 template/ 下，
因为 install.sh 是无排除的全量 copy_tree，放 template/ 会被分发进用户项目。
"""

import importlib.util
import pathlib
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
LINT_PATH = REPO_ROOT / "template" / ".claude" / "hooks" / "memory-lint.py"


def load_lint():
    """按路径加载被测脚本。"""
    spec = importlib.util.spec_from_file_location("memory_lint", LINT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["memory_lint"] = mod
    spec.loader.exec_module(mod)
    return mod


ml = load_lint()


# ---------------------------------------------------------------- fixtures


@pytest.fixture
def mem(tmp_path):
    """造一个空的假 memory 目录。"""
    d = tmp_path / "memory"
    d.mkdir()
    return d


def write(d, name, body="", desc=None):
    """在假 memory 目录里写一个 memory 文件；desc 非空时带 frontmatter。"""
    if desc is not None:
        body = "---\nname: %s\ndescription: %s\nmetadata:\n  type: project\n---\n\n%s" % (
            name.replace(".md", ""), desc, body)
    (d / name).write_text(body, encoding="utf-8")
    return d / name


def index(d, *lines):
    """写一级索引 MEMORY.md。"""
    (d / "MEMORY.md").write_text("# Memory Index\n\n" + "\n".join(lines) + "\n",
                                 encoding="utf-8")


# ---------------------------------------------------------------- 组 1


def test_模块可被加载():
    # Given: 被测脚本位于 template/.claude/hooks/ 下
    # When: 按路径加载它
    # Then: 加载成功且暴露三个阈值常量
    assert ml.LINE_WARN == 400
    assert ml.LINE_ERR == 700
    assert ml.INDEX_BUDGET == 28 * 1024


# ---------------------------------------------------------------- 组 2 目录推导


def test_memory目录由项目根正向推导():
    # Given: 两条真实形态的项目绝对路径
    # When: 推导各自的 memory 目录
    # Then: 路径中的 / 全被替换为 -，拼在 ~/.claude/projects/ 下
    home = pathlib.Path.home()
    assert ml.memory_dir_for("/Users/akarizo/Workspace/amc-afa") == (
        home / ".claude/projects/-Users-akarizo-Workspace-amc-afa/memory")
    assert ml.memory_dir_for("/a/b/c") == (
        home / ".claude/projects/-a-b-c/memory")


def test_memory目录不存在时静默返回(tmp_path):
    # Given: 一个不存在的 memory 目录
    # When: 执行检查
    # Then: 无任何 error 与 warn
    errs, warns = ml.run(tmp_path / "nope")
    assert errs == []
    assert warns == []


def test_无MEMORY_md时静默返回(mem):
    # Given: memory 目录存在但没有一级索引
    write(mem, "some-fact.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 不报孤儿，也不报任何其它问题
    assert errs == []
    assert warns == []


# ---------------------------------------------------------------- 组 3 索引解析


def test_单行内多个指针全部被提取():
    # Given: 一行索引里并排放了两个指针（amc-afa 的真实写法）
    text = "- 上传链路三条：[诊断教训](a-lessons.md) · [全链路事实](b-facts.md)\n"
    # When: 解析索引
    hits = ml.parse_index(text)
    # Then: 两个目标都被提取，且行号一致
    assert [h[2] for h in hits] == ["a-lessons.md", "b-facts.md"]
    assert all(h[0] == 1 for h in hits)


def test_二级索引登记的文件计入已登记(mem):
    # Given: 一级索引声明二级索引，二级索引登记了 old.md
    index(mem, "- 二级索引：[已 ship](index-shipped.md)")
    (mem / "index-shipped.md").write_text("- [旧 change](old.md)\n", encoding="utf-8")
    write(mem, "old.md", "内容")
    # When: 收集已登记集合
    reg = ml.collect_registered(mem)
    # Then: 二级索引自身与它登记的条目都在集合里
    assert "index-shipped.md" in reg
    assert "old.md" in reg


def test_普通文件正文里的链接不计入已登记(mem):
    # Given: 一个非 index- 命名的普通 memory 文件，正文里有指向别处的 markdown 链接
    index(mem, "- [某事实](plain.md)")
    write(mem, "plain.md", "参见 - [另一条](sneaky.md) 的说明\n")
    write(mem, "sneaky.md", "内容")
    # When: 收集已登记集合
    reg = ml.collect_registered(mem)
    # Then: sneaky.md 不得被计入 —— 否则孤儿会被漏报（漏报比误报更危险）
    assert "plain.md" in reg
    assert "sneaky.md" not in reg


def test_二级索引递归不因互相指向而死循环(mem):
    # Given: 两个二级索引互相指向对方
    index(mem, "- [A](index-a.md)")
    (mem / "index-a.md").write_text("- [B](index-b.md)\n", encoding="utf-8")
    (mem / "index-b.md").write_text("- [A](index-a.md)\n", encoding="utf-8")
    # When: 收集已登记集合
    reg = ml.collect_registered(mem)
    # Then: 正常返回且两者都在集合里
    assert "index-a.md" in reg
    assert "index-b.md" in reg


# ---------------------------------------------------------------- 组 4 双向闭合


def test_悬空指针报ERROR并指明文件名与行号(mem):
    # Given: 索引指向一个不存在的文件
    index(mem, "- [某状态](missing.md) — 说明")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 报一条 ERROR，含缺失文件名与行号
    assert len(errs) == 1
    assert "missing.md" in errs[0]
    assert ":3" in errs[0]  # 索引前两行是标题与空行


def test_孤儿文件报ERROR(mem):
    # Given: 实体文件存在但未被任何索引登记
    index(mem, "- [已登记](known.md)")
    write(mem, "known.md", "内容")
    write(mem, "orphan.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 只报 orphan.md 这一条孤儿
    assert len(errs) == 1
    assert "orphan.md" in errs[0]
    assert "known.md" not in errs[0]


def test_索引文件自身不被当作孤儿(mem):
    # Given: 一级索引声明了二级索引，二级索引登记了一个文件
    index(mem, "- 二级索引：[已 ship](index-shipped.md)")
    (mem / "index-shipped.md").write_text("- [旧](old.md)\n", encoding="utf-8")
    write(mem, "old.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: MEMORY.md 与 index-shipped.md 都不算孤儿，old.md 已登记
    assert errs == []


def test_重命名双面同时报出并给出归因(mem):
    # Given: 文件已改名，索引仍指向旧名
    index(mem, "- [某 change](x-propose-status.md)")
    write(mem, "x-applied-status.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 悬空与孤儿两条 ERROR 同时报出，并追加一句归因提示
    joined = "\n".join(errs)
    assert "x-propose-status.md" in joined
    assert "x-applied-status.md" in joined
    assert "重命名" in joined


# ---------------------------------------------------------------- 组 5 状态漂移


@pytest.mark.parametrize("text,expected", [
    ("change x 已 propose 未 apply", 1),
    ("已 apply 40/40 并预合并 origin/main，待开 MR", 3),
    ("已合 main 并部署 eks-test(rev 112)", 5),
    ("某个与推进阶段完全无关的事实描述", 0),
])
def test_阶段词按有序表取最高命中(text, expected):
    # Given: 一段可能含推进阶段词的文本
    # When: 提取阶段序号
    # Then: 取命中的最高阶段（apply+MR 取 MR、合并+部署 取部署）
    assert ml.stage_of(text) == expected


def test_索引落后于正文时报warn而非ERROR(mem):
    # Given: 索引行停在 propose 期，正文 description 已推进到待开 MR
    index(mem, "- [change x 已 propose 未 apply](x.md) — 说明")
    write(mem, "x.md", "正文", desc="change x 已 apply 40/40 待开 MR")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 只报 warn 不报 ERROR，且两侧状态词都出现在提示里
    assert errs == []
    assert len(warns) == 1
    assert "x.md" in warns[0]


def test_正文回顾历史阶段不触发误报(mem):
    # Given: 索引与 description 同为「已合 main」，但正文体里回顾了 propose 期
    index(mem, "- [change y 已合 main](y.md)")
    write(mem, "y.md", "此前 propose 时曾计划另一套方案，后来改了。",
          desc="change y 已合 main")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 不得产生任何 warn —— 只读 description 单行，不扫正文全文
    assert warns == []


def test_两侧阶段一致或无法判定时不出声(mem):
    # Given: 一条两侧一致、一条正文无阶段词
    index(mem,
          "- [change a 已合 main](a.md)",
          "- [change b 已 apply](b.md)")
    write(mem, "a.md", "正文", desc="change a 已合 main")
    write(mem, "b.md", "正文", desc="与阶段无关的纯事实描述")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 都不报
    assert warns == []


def test_正文无frontmatter时不报状态漂移(mem):
    # Given: 被指向文件没有 frontmatter
    index(mem, "- [change c 已 propose 未 apply](c.md)")
    write(mem, "c.md", "裸正文，没有 frontmatter")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 无法判定正文侧阶段，不出声
    assert warns == []


# ---------------------------------------------------------------- 组 6 字节预算


def line_of(nbytes, target="f.md"):
    """造一条恰好 nbytes 字节的索引行（ASCII 填充，便于精确控制）。"""
    base = "- [t](%s) — " % target
    pad = nbytes - len(base.encode("utf-8"))
    assert pad >= 0
    return base + "x" * pad


def test_索引行长分三档(mem):
    # Given: 三条分别为 400 / 401 / 701 字节的索引行
    index(mem, line_of(400, "a.md"), line_of(401, "b.md"), line_of(701, "c.md"))
    for n in ("a.md", "b.md", "c.md"):
        write(mem, n, "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 400 不出声、401 报 warn、701 报 ERROR
    # 行长是「行」的问题，定位靠 来源:行号（一行可含多个指针，报目标名有歧义）
    # index() 前两行是标题与空行，故三条行分别是第 3 / 4 / 5 行
    assert len(warns) == 1 and warns[0].startswith("MEMORY.md:4") and "401B" in warns[0]
    assert len(errs) == 1 and errs[0].startswith("MEMORY.md:5") and "701B" in errs[0]
    assert "MEMORY.md:3" not in "".join(errs + warns)


def test_行长按UTF8字节而非字符计(mem):
    # Given: 一行 200 个中文字符 —— 字符数 200 远小于阈值，字节数 600+ 已超 warn 线
    body = "坑" * 200
    line = "- [t](d.md) — " + body
    assert len(line) < ml.LINE_WARN            # 字符数不超线
    assert len(line.encode("utf-8")) > ml.LINE_WARN  # 字节数超线
    index(mem, line)
    write(mem, "d.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 按字节判定，报 warn 并给出真实字节数（616B），而非字符数 214
    assert len(warns) == 1
    assert warns[0].startswith("MEMORY.md:3")
    assert "616B" in warns[0]


def test_常驻索引总量超线报warn(mem):
    # Given: 一级索引自身就超过 28 KB
    filler = "- [t](e.md) — " + "x" * 300
    index(mem, *([filler] * 100))
    write(mem, "e.md", "内容")
    total = (mem / "MEMORY.md").stat().st_size
    assert total > ml.INDEX_BUDGET
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 有一条总量 warn，含实际字节与阈值
    budget_warns = [w for w in warns if "常驻索引" in w]
    assert len(budget_warns) == 1
    assert str(total) in budget_warns[0] or "KB" in budget_warns[0]


def test_二级索引不计入常驻总量(mem):
    # Given: MEMORY.md 自身在预算内，但加上二级索引就会超线
    filler = "- [t](e.md) — " + "x" * 300
    index(mem, *([filler] * 60))                       # ~19 KB，在 28 KB 内
    (mem / "index-big.md").write_text(
        "\n".join([filler] * 60), encoding="utf-8")    # 再 ~19 KB
    write(mem, "e.md", "内容")
    assert (mem / "MEMORY.md").stat().st_size < ml.INDEX_BUDGET
    assert ((mem / "MEMORY.md").stat().st_size
            + (mem / "index-big.md").stat().st_size) > ml.INDEX_BUDGET
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 不报总量 warn —— 二级索引按需 recall、不常驻，
    #       把它算进常驻会惩罚「下沉」这个正确行为（下沉后 warn 不消失）
    assert [w for w in warns if "常驻索引" in w] == []


def test_总量未超线时不报(mem):
    # Given: 一个小索引
    index(mem, "- [t](f.md)")
    write(mem, "f.md", "内容")
    # When: 执行检查
    errs, warns = ml.run(mem)
    # Then: 无总量 warn
    assert [w for w in warns if "常驻索引" in w] == []


# ---------------------------------------------------------------- 组 7 hook 入口


import io
import json


def feed(monkeypatch, payload):
    """把 payload 作为 stdin 喂给 cmd_hook。"""
    text = payload if isinstance(payload, str) else json.dumps(payload)
    monkeypatch.setattr(ml.sys, "stdin", io.StringIO(text))


def test_写入未登记的memory文件时报孤儿并返回2(mem, monkeypatch, capsys):
    # Given: 索引里没有登记刚写的 new-fact.md
    index(mem, "- [已登记](known.md)")
    write(mem, "known.md", "内容")
    newf = write(mem, "new-fact.md", "刚写的内容")
    feed(monkeypatch, {"tool_input": {"file_path": str(newf)}})
    # When: PostToolUse 触发
    rc = ml.cmd_hook()
    # Then: 返回 2，stderr 含孤儿提示
    assert rc == 2
    assert "new-fact.md" in capsys.readouterr().err


def test_写入非memory文件不触发(tmp_path, monkeypatch, capsys):
    # Given: 写的是仓库内一个普通文件
    ordinary = tmp_path / "some_code.py"
    ordinary.write_text("print(1)\n", encoding="utf-8")
    feed(monkeypatch, {"tool_input": {"file_path": str(ordinary)}})
    # When: PostToolUse 触发
    rc = ml.cmd_hook()
    # Then: 静默返回 0
    assert rc == 0
    assert capsys.readouterr().err == ""


def test_memory目录干净时返回0(mem, monkeypatch, capsys):
    # Given: 索引与实体文件完全闭合
    index(mem, "- [已登记](known.md)")
    known = write(mem, "known.md", "内容")
    feed(monkeypatch, {"tool_input": {"file_path": str(known)}})
    # When: PostToolUse 触发
    rc = ml.cmd_hook()
    # Then: 返回 0 且无输出
    assert rc == 0
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize("payload", [
    "这不是合法 JSON {{{",
    {},
    {"tool_input": {}},
    {"tool_input": {"file_path": ""}},
])
def test_异常输入一律fail_open(payload, monkeypatch):
    # Given: 各种畸形 payload
    feed(monkeypatch, payload)
    # When: PostToolUse 触发
    rc = ml.cmd_hook()
    # Then: 一律返回 0，不抛异常 —— 坏门禁不能锁死编辑
    assert rc == 0


def test_内部异常时fail_open(mem, monkeypatch):
    # Given: run() 内部抛出未预期异常
    index(mem, "- [x](x.md)")
    x = write(mem, "x.md", "内容")
    feed(monkeypatch, {"tool_input": {"file_path": str(x)}})

    def boom(*a, **kw):
        raise RuntimeError("模拟内部异常")

    monkeypatch.setattr(ml, "run", boom)
    # When: PostToolUse 触发
    rc = ml.cmd_hook()
    # Then: 静默放行
    assert rc == 0


def test_main三种入参(mem, monkeypatch, capsys):
    # Given: 一个有孤儿的 memory 目录
    index(mem, "- [已登记](known.md)")
    write(mem, "known.md", "内容")
    write(mem, "orphan.md", "内容")
    monkeypatch.setattr(ml, "memory_dir_for", lambda root: mem)
    # When/Then: 无参与 --all 都走全量，有 ERROR 返回 2
    assert ml.main([]) == 2
    assert ml.main(["--all"]) == 2
    capsys.readouterr()
    # When/Then: --hook 且目标不在 memory 内 → 静默 0
    feed(monkeypatch, {"tool_input": {"file_path": "/tmp/other.py"}})
    assert ml.main(["--hook"]) == 0
