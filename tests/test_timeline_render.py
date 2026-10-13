"""落地记录从账本生成（scenario: flight-ledger-records#render-records-from-ledger、#report-reads-ledger）。骨架：S2 实现后去掉 xfail 标记。"""
import pytest


@pytest.mark.xfail(strict=True, reason="S2：尚未实现")
def test_render_records_from_ledger(tmp_path):
    # Given: gate-baseline.json 与一份含 approve 至 land 共 10 条事件的账本；change 目录已有手写的 timeline.md（junk）
    # When: 连续运行两次 timeline.py render
    # Then: 两次退出 0、events 为 10；timeline.md 为 baseline 加 10 行事件且无 junk；gate-report 门禁表恰 3 行、天花板表含 src/a.py:3；两次输出逐字节相同
    pytest.fail("骨架：S2 写实断言")


@pytest.mark.xfail(strict=True, reason="S2：尚未实现")
def test_report_reads_ledger(tmp_path):
    # Given: 没有 timeline.md；账本有 approve 10:00、S1 派发 10:01、S1 gate ok 10:07、final 红与绿、land 10:20、ship 10:30、一条 diag
    # When: 运行 timeline.py report，再运行 timeline.py record approve
    # Then: report 含批准 → apply 完成 20.0、PR 打开 30.0、S1 派发 → 门禁绿 6.0、门禁红次数 1、诊断 1 条；record 退出 2 且未生成 timeline.md
    pytest.fail("骨架：S2 写实断言")
