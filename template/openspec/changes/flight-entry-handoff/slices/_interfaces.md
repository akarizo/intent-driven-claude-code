# 公开接口摘要

## S3

### template/plugins/flight/hooks/envelope.ts
```
export type Who = { role: Role; worktree: string; owns: readonly string[] }
export type ActiveTree = { change: string; changeTree: string; slicePrefix: string }
export type Deny = { deny: string }
export function normalizePath(p: string): string {
export function globMatch(path: string, pattern: string): boolean {
export function writeTarget(tool: string, input: unknown): string | undefined {
export function writeVerdict(who: Who, absPath: string): Deny | undefined {
export function inWorktree(command: string, worktree: string): string {
export function bashVerdict(role: Role, command: string, worktree?: string, _mainTree?: string): Deny | undefined {
export function bashUpgradable(role: Role, command: string, commands: readonly string[], worktree?: string, mainTree?: string): boolean {
export function readUpgradable(tool: string, input: unknown, worktree: string, mainTree: string): boolean {
export function mainSessionVerdict(active: readonly ActiveTree[], tool: string, input: unknown): Deny | undefined {
export function spawnVerdict(x: { subagentType: string; originPlugin: string | undefined; model: string | undefined; parentInFlight: boolean }): Deny | undefined {
```
