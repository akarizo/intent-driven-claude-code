# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-12T00:56:43Z | S2 | template/plugins/flight/hooks/envelope.ts:188 | 不区分引号，双引号里的反引号（如 `"`x`"`）前面留下的 `"` 算作一个词而不判 | 漏拒出现时换成 shell 词法分析。 |
| 2026-10-12T00:56:43Z | S2 | template/plugins/flight/hooks/envelope.ts:291 | 参数里的展开不判（`git commit -m "$(cat msg)"` 放行）；引号内的分隔符照旧切段 | 出现绕过时换成 shell 词法分析。 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-12T00:56:39Z | S3 | ok | 7675db14a3 | - | - |
| 2026-10-12T00:56:43Z | S2 | ok | 1e154463a5 | - | - |
| 2026-10-12T00:56:49Z | S4 | ok | ecf5113464 | - | - |
| 2026-10-12T01:00:03Z | S1 | ok | 7ffbec5eee | - | - |
| 2026-10-12T01:05:12Z | final | ok | 1c5da8617a | - | G2 test: 复用修复门禁 79fdbcf9cc 的全量结论（其后只有记账改动） |
