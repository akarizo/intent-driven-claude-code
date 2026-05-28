# 原型示意图样例

`spec-html-render` 在判定 capabilities 涉及 UI / 数据流 / 状态机时，会从这里挑 1-3 个样例**改写**进 `block:mockups`。

> **关键**：每个样例都是 **inline HTML + SVG/CSS**，可以直接嵌入 `spec.html` 的 `block:mockups` 区域，不依赖任何外部资源。改写时把 placeholder 文字 (`<字段名>` / "示例…") 替换成本 change 的真实内容。
>
> 容器统一用：
>
> ```html
> <div class="mockup-frame">
>   <div class="caption">原型示意：…</div>
>   <!-- 样例正文 -->
> </div>
> ```

---

## 1. 移动端卡片 (mobile card)

**适用**：移动端任意单页面、列表项、卡片态。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：移动端用户中心列表 — 头像 + 主信息 + 操作</div>
  <svg viewBox="0 0 360 600" width="280" style="border:1px solid var(--color-border); border-radius:24px; background:var(--color-bg);">
    <rect x="0" y="0" width="360" height="44" fill="var(--color-surface-2)"/>
    <text x="20" y="28" font-family="ui-monospace" font-size="14" fill="var(--color-fg-muted)">09:41</text>
    <text x="180" y="28" text-anchor="middle" font-family="-apple-system" font-size="16" font-weight="600" fill="var(--color-fg)">用户中心</text>
    <g transform="translate(0,60)">
      <rect x="16" y="0" width="328" height="80" rx="12" fill="var(--color-surface)" stroke="var(--color-border)"/>
      <circle cx="52" cy="40" r="22" fill="var(--color-accent-soft)"/>
      <text x="52" y="46" text-anchor="middle" font-size="18" fill="var(--color-accent)" font-weight="700">A</text>
      <text x="88" y="36" font-size="15" font-weight="600" fill="var(--color-fg)">阿卡里佐</text>
      <text x="88" y="56" font-size="12" fill="var(--color-fg-muted)">Pro · 已认证</text>
      <text x="316" y="46" text-anchor="end" font-size="20" fill="var(--color-fg-muted)">›</text>
    </g>
    <g transform="translate(0,160)">
      <text x="20" y="20" font-size="12" font-weight="600" fill="var(--color-fg-muted)" letter-spacing="1">操作</text>
      <rect x="16" y="32" width="328" height="56" rx="10" fill="var(--color-surface)" stroke="var(--color-border)"/>
      <text x="32" y="64" font-size="14" fill="var(--color-fg)">导出我的数据</text>
      <text x="328" y="64" text-anchor="end" font-size="18" fill="var(--color-fg-muted)">›</text>
      <rect x="16" y="96" width="328" height="56" rx="10" fill="var(--color-surface)" stroke="var(--color-border)"/>
      <text x="32" y="128" font-size="14" fill="var(--color-fg)">隐私偏好</text>
      <text x="328" y="128" text-anchor="end" font-size="18" fill="var(--color-fg-muted)">›</text>
    </g>
  </svg>
</div>
```

---

## 2. 后台表单 (admin form)

**适用**：表单提交、设置面板、单步配置。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：管理后台 — 单步表单，字段、说明、主按钮</div>
  <div style="max-width:520px; padding:var(--space-4); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-lg);">
    <div style="font-family:var(--font-display); font-size:var(--text-xl); font-weight:600; margin-bottom:var(--space-1);">新建 API Key</div>
    <div style="color:var(--color-fg-muted); font-size:var(--text-sm); margin-bottom:var(--space-4);">创建后仅展示一次，请妥善保存。</div>

    <label style="display:block; font-size:var(--text-sm); font-weight:600; margin-bottom:var(--space-1);">名称</label>
    <div style="border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:var(--space-2) var(--space-3); margin-bottom:var(--space-4); font-family:var(--font-mono); color:var(--color-fg-muted);">staging-bot</div>

    <label style="display:block; font-size:var(--text-sm); font-weight:600; margin-bottom:var(--space-1);">权限范围</label>
    <div style="display:flex; gap:var(--space-2); margin-bottom:var(--space-5); flex-wrap:wrap;">
      <span class="tag" style="border-color:var(--color-accent); color:var(--color-accent); background:var(--color-accent-soft);">read</span>
      <span class="tag">write</span>
      <span class="tag">delete</span>
    </div>

    <div style="display:flex; gap:var(--space-2); justify-content:flex-end;">
      <button style="padding:var(--space-2) var(--space-4); background:transparent; color:var(--color-fg-muted); border:1px solid var(--color-border); border-radius:var(--radius-sm); font-family:var(--font-mono); font-size:var(--text-sm);">取消</button>
      <button style="padding:var(--space-2) var(--space-4); background:var(--color-fg); color:var(--color-bg); border:0; border-radius:var(--radius-sm); font-family:var(--font-mono); font-size:var(--text-sm); font-weight:600;">创建</button>
    </div>
  </div>
</div>
```

---

## 3. 数据流 (data flow / pipeline)

**适用**：ETL、消息流、microservice 间数据传递、CQRS 写读分离。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：数据接入流水线 — 源 → 队列 → 处理 → 仓</div>
  <div class="diagram-frame">
    <div class="mermaid">
flowchart LR
  src["业务库<br/>(Postgres)"]:::edge
  cdc["Debezium CDC"]:::stage
  q["Kafka<br/>events.users"]:::queue
  proc["Stream Job<br/>(Flink)"]:::stage
  dw[("仓库<br/>ClickHouse")]:::edge

  src -->|binlog| cdc
  cdc -->|JSON| q
  q --> proc
  proc -->|去重/聚合| dw

  classDef edge fill:#dbeafe,stroke:#1d4ed8,color:#1d4ed8;
  classDef stage fill:#fef3c7,stroke:#b45309,color:#b45309;
  classDef queue fill:#dcfce7,stroke:#15803d,color:#15803d;
    </div>
    <div class="caption">每节点的延迟预算 / 失败重试在 design.md 标注；本图只画拓扑。</div>
  </div>
</div>
```

---

## 4. 状态机 (state machine)

**适用**：订单状态、工单流转、审批流、agent 生命周期。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：审批工单状态机 — 节点为状态、边为事件</div>
  <div class="diagram-frame">
    <div class="mermaid">
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: 提交
  Submitted --> Approved: 通过
  Submitted --> Rejected: 驳回
  Rejected --> Draft: 重新编辑
  Approved --> Closed: 落地完成
  Closed --> [*]
    </div>
    <div class="caption">仅画核心节点；超时 / 异常分支在 design.md 列举。</div>
  </div>
</div>
```

---

## 5. 时序 (sequence)

**适用**：跨服务调用、登录流、支付流、用户与系统交互。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：登录时序 — 客户端 ↔ 网关 ↔ Auth ↔ DB</div>
  <div class="diagram-frame">
    <div class="mermaid">
sequenceDiagram
  actor U as 用户
  participant C as 客户端
  participant G as 网关
  participant A as Auth 服务
  participant D as 用户库

  U->>C: 输入凭据
  C->>G: POST /login
  G->>A: verify(user, pw)
  A->>D: SELECT user
  D-->>A: row
  A-->>G: JWT
  G-->>C: 200 + Set-Cookie
  C-->>U: 进入首页
    </div>
    <div class="caption">错误分支 (4xx) 不画在主线，仅在 design.md 列出。</div>
  </div>
</div>
```

---

## 6. 卡片网格 / 仪表盘 (dashboard tiles)

**适用**：监控面板、概览页、KPI 一屏看。

```html
<div class="mockup-frame">
  <div class="caption">原型示意：监控概览 — 4 个核心指标 tile + 1 个趋势带</div>
  <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:var(--space-3);">
    <div style="padding:var(--space-3); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-md);">
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-fg-muted); letter-spacing:.1em;">QPS</div>
      <div style="font-family:var(--font-display); font-size:var(--text-2xl); font-weight:700; margin-top:var(--space-1);">1,247</div>
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-new);">▲ 12%</div>
    </div>
    <div style="padding:var(--space-3); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-md);">
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-fg-muted); letter-spacing:.1em;">P99</div>
      <div style="font-family:var(--font-display); font-size:var(--text-2xl); font-weight:700; margin-top:var(--space-1);">182<span style="font-size:var(--text-base); color:var(--color-fg-muted);">ms</span></div>
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-modified);">▲ 8%</div>
    </div>
    <div style="padding:var(--space-3); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-md);">
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-fg-muted); letter-spacing:.1em;">错误率</div>
      <div style="font-family:var(--font-display); font-size:var(--text-2xl); font-weight:700; margin-top:var(--space-1);">0.21<span style="font-size:var(--text-base); color:var(--color-fg-muted);">%</span></div>
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-removed);">▲ 0.05</div>
    </div>
    <div style="padding:var(--space-3); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-md);">
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-fg-muted); letter-spacing:.1em;">活跃用户</div>
      <div style="font-family:var(--font-display); font-size:var(--text-2xl); font-weight:700; margin-top:var(--space-1);">3.2<span style="font-size:var(--text-base); color:var(--color-fg-muted);">k</span></div>
      <div style="font-family:var(--font-mono); font-size:var(--text-xs); color:var(--color-fg-muted);">— 持平</div>
    </div>
  </div>
  <svg viewBox="0 0 640 80" style="width:100%; margin-top:var(--space-3);">
    <polyline points="0,60 40,55 80,58 120,50 160,52 200,40 240,42 280,30 320,32 360,28 400,35 440,30 480,20 520,22 560,15 600,18 640,10"
              fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="0,60 40,55 80,58 120,50 160,52 200,40 240,42 280,30 320,32 360,28 400,35 440,30 480,20 520,22 560,15 600,18 640,10"
              fill="var(--color-accent-soft)" stroke="none" opacity="0.5"
              transform="translate(0,0)" />
  </svg>
</div>
```

---

## 改写守则

1. **不要照搬**。每个样例都是骨架，必须把字段名、值、capability 名替换为本 change 的实际语义。
2. **总数 ≤ 3**。多了反而干扰审批；选最能让"做什么"一眼明白的。
3. **混合优先级**：如果 capabilities 同时含 UI 和数据流，挑 1 个 UI + 1 个流；不要两个都画 UI。
4. **caption 中文化**：每个 mockup 前的 `<div class="caption">原型示意：...</div>` 要写清楚"它代表什么"。
5. **图示用 Mermaid，UI 用 SVG / inline HTML**：图示靠 CDN 渲染；UI 草图不依赖外部，离线也能看。
