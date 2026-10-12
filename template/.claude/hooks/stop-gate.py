#!/usr/bin/env python3
"""stop-gate · 已退役：旧引擎的执行体自跑门禁用；插件由控制面在收口时跑门禁。

保留空壳只为兼容仍不带存在保护注册它的 settings（删除文件会让 Stop hook 报错）；新安装不再注册。
读掉 stdin，不输出，退出 0。兼容 Python 3.8+。
"""
import sys


def main():
    try:
        sys.stdin.read()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
