# 公开接口摘要

## S2

### template/plugins/flight/hooks/versions.ts
```
export type VersionCheck = { ok: true; line: string } | { ok: false; reason: string }
export const REQUIRED_FEATURES = ['evidence-ledger-only', 'g5-per-target', 'guards'] as const
export async function checkPluginCopy(io: Io, x: { pluginRoot: string; configDir: string; mainTree: string }): Promise<VersionCheck> {
export async function checkJudges(io: Io, x: { hooksDir: string; required: readonly string[] }): Promise<VersionCheck> {
```

## S6

### template/plugins/flight/hooks/abort.ts
```
export async function abortFlight(x: {
```
