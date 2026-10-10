# 公开接口摘要

## S6

### template/plugins/flight/hooks/versions.ts
```
export type VersionCheck = { ok: true; line: string } | { ok: false; reason: string }
export async function checkPluginCopy(io: Io, x: { pluginRoot: string; configDir: string; mainTree: string }): Promise<VersionCheck> {
export async function checkJudges(io: Io, x: { hooksDir: string; required: readonly string[] }): Promise<VersionCheck> {
```
