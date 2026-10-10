# 公开接口摘要

## S2

### template/plugins/flight/hooks/landing.tsx
```
export const FINDINGS_TOOL: { name: 'submit_findings'; description: string; inputSchema: Record<string, unknown> } = {
export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }> {
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void> {
```

## S5
