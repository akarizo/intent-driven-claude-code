# 片间接口（flight-dispatch-followups）

三片在同一 wave 并行，owns 互不相交，彼此不依赖对方的新接口。

## 三片都要知道
- **派发只在处理外部事件、尚未返回的 hook 里发生**（`DRAFT-flight-dispatch-live-frame`）：
  - 定时器回调没有活凭证，派发会被拒；
  - 不要在锁释放处、定时器回调里直接重试起飞，要重试就走唤醒轮。
- **测试世界模拟不出 origin，也模拟不出撞锁的微小窗口**：能用纯函数测的就放进纯函数（`armed.ts`）。

## S1 交出（只在 orchestrator / armed 内部使用）
- `armed.ts`：
  - `export const WAKE_FOOTER = '这一轮只回复「收到」，不要做别的，也不要发 /opsx-apply。'`；
  - `export function afterMissedTurn(arm: Arm): Arm`；
  - `Arm` 新增字段 `missedTurn: boolean` 与 `submittedAt?: number`。
- `types/index.d.ts`：`FlightArmedItem` 同步加 `missedTurn: boolean`。

## S2

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

## S3
