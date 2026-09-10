"""spec_html.py 脚本渲染（scenario: executable-specs#spec-html-renders-artifacts / spec-html-flight-block）。"""
import json

from conftest import run_hook, write

NOW = "2026-09-10T00:00:00Z"


def artifacts(change):
    write(change / "proposal.md", """
        ## Why

        导出功能缺失，客户无法自助拿数据。

        ## What Changes

        - 新增 CSV 导出
        - **BREAKING** 无

        ## Capabilities

        ### New Capabilities
        - `data-export`: 用户导出自己的数据

        ### Modified Capabilities

        ## Impact

        - 影响 api 与 models
    """)
    write(change / "specs" / "data-export" / "spec.md", """
        ## ADDED Requirements

        ### Requirement: 用户数据导出
        系统 SHALL 允许用户导出自己的数据。

        #### Scenario: csv-export-succeeds
        - **GIVEN** 用户有已保存的数据
        - **WHEN** 用户请求 CSV 导出
        - **THEN** 得到一个 CSV 文件
    """)
    write(change / "design.md", """
        ## Context

        现状说明。

        ## Decisions

        - 选 CSV 而非 XLSX：更通用

        流程如下：

        ```mermaid
        flowchart LR
          A[请求] --> B[生成 CSV]
        ```

        ## Risks / Trade-offs

        - [大文件] → 分页
    """)
    write(change / "tasks.md", "## S1 模型 · deps: -\n\n- [x] S1 建模型\n\n## S2 接口 · deps: S1\n\n- [ ] S2 写接口\n")
    return change


def render(change, out):
    return run_hook("spec_html", "--change-dir", str(change), "--out", str(out), "--now", NOW)


def test_spec_html_renders_artifacts(tmp_path):
    # Given: 一个 change 目录含 proposal.md、specs/data-export/spec.md、design.md（含 mermaid 块）、tasks.md（一勾一未勾）
    change = artifacts(tmp_path / "openspec" / "changes" / "add-export")
    out = tmp_path / "spec.html"

    # When: 运行 spec_html.py --change-dir --out
    p = render(change, out)

    # Then: 退出 0；why 块含 Why 正文且 marker 保留；specs 块含 requirement / scenario 结构与 GIVEN 关键字；tasks 块含一个勾选与一个未勾选；diagrams 块含 mermaid 文本；mockups 块保留占位
    assert p.returncode == 0, p.stderr
    html = out.read_text(encoding="utf-8")
    assert "<!-- block:why -->" in html and "客户无法自助拿数据" in html
    assert 'class="requirement"' in html and 'class="scenario"' in html and 'data-kw="GIVEN"' in html
    assert 'type="checkbox" disabled checked' in html and 'type="checkbox" disabled>' in html
    assert 'class="mermaid"' in html and "flowchart LR" in html
    assert "仅当 capabilities 涉及" in html


def test_spec_html_flight_block(tmp_path):
    # Given: change 目录含 slices.json（2 片，S2 依赖 S1，各有 scenario 映射）、timeline.md（approve 事件）、一个 xfail 骨架与一个已解锁的测试
    root = tmp_path
    change = artifacts(root / "openspec" / "changes" / "add-export")
    write(change / "slices.json", json.dumps({
        "version": 1, "change": "add-export", "gate": {"test": "pytest -q"},
        "slices": [
            {"id": "S1", "title": "数据模型", "scenarios": ["data-export#csv-export-succeeds"], "owns": ["app/models/export.py", "tests/test_export.py"], "deps": [], "verify": "pytest -q tests/test_export.py"},
            {"id": "S2", "title": "导出接口", "scenarios": ["data-export#api"], "owns": ["app/api/export.py", "tests/test_api.py"], "deps": ["S1"], "verify": "pytest -q tests/test_api.py"},
        ],
        "scenario_tests": {"data-export#csv-export-succeeds": "tests/test_export.py::test_csv", "data-export#api": "tests/test_api.py::test_api"},
    }, ensure_ascii=False))
    write(change / "timeline.md", "<!-- timeline -->\n2026-09-10T01:00:00Z\tapprove\t\n")
    write(root / "tests" / "test_export.py", "def test_csv():\n    # Given: x\n    # When: y\n    # Then: z\n    assert True\n")
    write(root / "tests" / "test_api.py", "import pytest\n\n@pytest.mark.xfail(strict=True, reason='pending')\ndef test_api():\n    # Given: x\n    # When: y\n    # Then: z\n    assert False\n")
    out = tmp_path / "spec.html"

    # When: 渲染
    p = render(change, out)

    # Then: 输出含 id="flight" 的飞行计划区：两个切片 id 与标题、wave 分组、owns 路径、scenario 状态（unlocked 与 pending）、approve 事件
    assert p.returncode == 0, p.stderr
    html = out.read_text(encoding="utf-8")
    assert 'id="flight"' in html
    assert "S1" in html and "数据模型" in html and "S2" in html and "导出接口" in html
    assert "wave 1" in html and "wave 2" in html
    assert "app/models/export.py" in html
    assert "unlocked" in html and "pending" in html
    assert "approve" in html


def test_spec_html_idempotent(tmp_path):
    # Given: 同一份工件
    change = artifacts(tmp_path / "openspec" / "changes" / "add-export")
    a, b = tmp_path / "a.html", tmp_path / "b.html"

    # When: 用相同的 --now 渲染两次
    render(change, a)
    render(change, b)

    # Then: 两次输出字节级一致
    assert a.read_bytes() == b.read_bytes()


def test_spec_html_flight_multiline_decorator(tmp_path):
    # Given: change 目录含 slices.json（单片，scenario 映射到测试函数），该测试函数用跨行 xfail 装饰器
    #        （装饰器调用跨多行，而不是单行 @pytest.mark.xfail(...)）
    root = tmp_path
    change = artifacts(root / "openspec" / "changes" / "add-export")
    write(change / "slices.json", json.dumps({
        "version": 1, "change": "add-export", "gate": {"test": "pytest -q"},
        "slices": [
            {"id": "S1", "title": "数据模型", "scenarios": ["data-export#csv-export-succeeds"], "owns": ["app/models/export.py", "tests/test_export.py"], "deps": [], "verify": "pytest -q tests/test_export.py"},
        ],
        "scenario_tests": {"data-export#csv-export-succeeds": "tests/test_export.py::test_csv"},
    }, ensure_ascii=False))
    write(root / "tests" / "test_export.py",
          "import pytest\n\n"
          "@pytest.mark.xfail(\n"
          "    strict=True,\n"
          "    reason='pending',\n"
          ")\n"
          "def test_csv():\n"
          "    # Given: x\n"
          "    # When: y\n"
          "    # Then: z\n"
          "    assert False\n")
    out = tmp_path / "spec.html"

    # When: 渲染
    p = render(change, out)

    # Then: 跨行装饰器仍要被识别为 xfail —— scenario 状态是 pending，不能因装饰器折行就误判成 unlocked
    assert p.returncode == 0, p.stderr
    html = out.read_text(encoding="utf-8")
    assert '<span class="chip" data-state="pending">pending</span>' in html
    assert '<span class="chip" data-state="unlocked">unlocked</span>' not in html


def test_spec_html_missing_change_dir(tmp_path):
    # Given: 一个不存在的 change-dir 路径
    change = tmp_path / "openspec" / "changes" / "does-not-exist"
    out = tmp_path / "spec.html"

    # When: 用该路径运行 spec_html.py
    p = render(change, out)

    # Then: 非 0 退出，且不静默 makedirs + 写出空壳 spec.html
    assert p.returncode != 0
    assert not out.exists()


def test_spec_html_zero_sections_no_render(tmp_path):
    # Given: change-dir 存在但没有任何工件（proposal/design/tasks/specs/slices.json 全缺）
    change = tmp_path / "openspec" / "changes" / "empty-change"
    change.mkdir(parents=True)
    out = tmp_path / "spec.html"

    # When: 渲染
    p = render(change, out)

    # Then: 恢复旧 Guardrail「artifact = 0 时不渲染」—— 非 0 退出，不写出只剩占位符的空壳文件
    assert p.returncode != 0
    assert not out.exists()
