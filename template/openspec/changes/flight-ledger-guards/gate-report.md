# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-13T01:24:10Z | S4 | template/plugins/flight/hooks/envelope.ts:457 | 双引号内的 `$(…)` / 反引号里的命令不再解析；`#` 注释不认 | 出现漏判时把引号内的命令替换也递归切开。 |
| 2026-10-13T01:24:10Z | S4 | template/plugins/flight/hooks/envelope.ts:552 | 不区分各实现（GNU / BSD）的选项差异，按并集查表 | 误判出现时按命令补表。 |
| 2026-10-13T01:24:10Z | S4 | template/plugins/flight/hooks/envelope.ts:619 | mv 的源文件被移走也算改动，这里只取目的地（design D6） | 出现借 mv 搬走 owns 外文件时把源也算进来 |
| 2026-10-13T01:24:10Z | S4 | template/plugins/flight/hooks/envelope.ts:635 | 只认上面这些写法（xargs、find -delete、解释器脚本内部的写入都不认） | 出现漏判时补命令表。 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-13T01:20:13Z | S3 | ok | 939e800213 | - | - |
| 2026-10-13T01:20:13Z | S5 | ok | ff35bee09f | - | - |
| 2026-10-13T01:20:41Z | S2 | ok | c1e22b1955 | - | - |
| 2026-10-13T01:24:10Z | S4 | ok | e7ebb80655 | - | - |
| 2026-10-13T01:29:14Z | S1 | ok | 64e7a7e459 | - | - |
