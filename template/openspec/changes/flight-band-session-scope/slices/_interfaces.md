# 公开接口摘要

## S2

## S1

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

### template/plugins/flight/hooks/orchestrator.tsx
```
export const HOST_ORIGINS = ['composer', 'bridge', 'sdk']
export function originOf(e: unknown): string | undefined {
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean; lease?: Lease } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean; lease?: Lease }): Promise<string> {
export function restoreStatusNow(): Promise<void> {
export function registerOrchestrator(on: On): void {
```

### template/plugins/flight/types/index.d.ts
```
export type FlightItem = {
export type FlightArmedItem = {
export type FlightArmed = { items: Record<string, FlightArmedItem> }
export type FlightBand = {
export type FlightPanel = {
```
