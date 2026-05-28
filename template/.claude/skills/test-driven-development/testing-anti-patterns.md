# 测试反模式

**何时加载此参考**：写或改测试时、引入 mock 时、想在生产代码里加只为测试用的方法时。

## 概述

测试必须验证**真实行为**，而不是 mock 的行为。Mock 是隔离工具，不是被测对象本身。

**核心原则**：测代码做了什么，而不是测 mock 做了什么。

**严格遵守 TDD 可以防止以下所有反模式。**

## 三条铁律

```
1. 永不测试 mock 的行为
2. 永不在生产类里加只供测试调用的方法
3. 永不在没搞懂依赖关系时就 mock
```

## 反模式 1：测试 mock 自身的行为

**违反样例：**
```typescript
// ❌ 错：在断言 mock 本身存在
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
```

**为什么错：**
- 你验证的是 mock 存在，不是组件能工作
- 测试在 mock 存在时通过，mock 移除就失败
- 关于真实行为什么都没说

**人类伙伴的反问**：「我们是不是在测一个 mock 的行为？」

**修法：**
```typescript
// ✅ 对：要么测真组件，要么干脆别 mock
test('renders sidebar', () => {
  render(<Page />);  // 不 mock sidebar
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

// 或者，如果出于隔离必须 mock sidebar：
// 不要断言 mock 本身——测 Page 在 sidebar 存在时的行为
```

### Gate Function

```
对任何 mock 元素下断言之前：
  自问："我在测真实组件行为，还是只在测 mock 是否存在？"

  如果在测 mock 是否存在：
    停 — 删掉这条断言，或者把组件解除 mock

  改测真实行为
```

## 反模式 2：生产类里的测试专用方法

**违反样例：**
```typescript
// ❌ 错：destroy() 只在测试里被调用
class Session {
  async destroy() {  // 看起来像生产 API！
    await this._workspaceManager?.destroyWorkspace(this.id);
    // ... cleanup
  }
}

// 在测试里
afterEach(() => session.destroy());
```

**为什么错：**
- 生产类被测试专用代码污染
- 生产环境意外调用会很危险
- 违反 YAGNI 与关注点分离
- 把对象生命周期和实体生命周期混在一起

**修法：**
```typescript
// ✅ 对：测试清理交给测试工具
// Session 没有 destroy()，在生产里是无状态的

// 在 test-utils/ 里
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id);
  }
}

// 在测试里
afterEach(() => cleanupSession(session));
```

### Gate Function

```
往生产类里加任何方法之前：
  自问："这个方法是不是只有测试在调用？"

  如果是：
    停 — 别加
    放到测试工具里

  再自问："这个类是不是该资源的生命周期持有者？"

  如果不是：
    停 — 这个方法该挂在别的类上
```

## 反模式 3：不搞懂依赖关系就 mock

**违反样例：**
```typescript
// ❌ 错：mock 把测试需要的逻辑屏蔽掉了
test('detects duplicate server', () => {
  // 这个 mock 阻止了测试依赖的 config 写入！
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
  }));

  await addServer(config);
  await addServer(config);  // 本应抛重复错——但不会抛！
});
```

**为什么错：**
- 被 mock 的方法有测试依赖的副作用（写 config）
- 为了"保险"过度 mock，把真实行为破坏了
- 测试因为错误的原因通过，或神秘地失败

**修法：**
```typescript
// ✅ 对：在正确层级 mock
test('detects duplicate server', () => {
  // 只 mock 慢的部分，保留测试需要的行为
  vi.mock('MCPServerManager'); // 只 mock 启动慢的服务

  await addServer(config);  // config 被写入
  await addServer(config);  // 重复被检测到 ✓
});
```

### Gate Function

```
mock 任何方法之前：
  停 — 先别 mock

  1. 自问："这个真实方法有什么副作用？"
  2. 自问："本测试是否依赖这些副作用？"
  3. 自问："我是否完全理解这个测试需要什么？"

  如果依赖某个副作用：
    在更低层级 mock（实际慢/外部的那一步）
    或用能保留必要行为的 test double
    而不是 mock 测试依赖的这个高层方法

  如果不确定测试依赖什么：
    先用真实实现把测试跑一遍
    观察真正需要发生什么
    然后在正确层级加最小 mock

  红旗：
    - "我先 mock 它，保险"
    - "这个可能慢，先 mock 了再说"
    - 没搞懂依赖链就 mock
```

## 反模式 4：不完整的 mock

**违反样例：**
```typescript
// ❌ 错：只 mock 了你以为要用的字段
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // 漏：下游代码用的 metadata
};

// 后来：代码访问 response.metadata.requestId 时炸了
```

**为什么错：**
- **部分 mock 隐藏了结构假设** —— 你只 mock 了你知道的字段
- **下游代码可能依赖你没写进去的字段** —— 沉默失败
- **测试通过但集成失败** —— mock 残缺，真 API 完整
- **虚假的信心** —— 测试什么都没证明

**铁律**：mock 必须**完整**镜像真实数据结构，不能只放你当下测试用得到的字段。

**修法：**
```typescript
// ✅ 对：镜像真实 API 的完整性
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
  // 真 API 返回的所有字段
};
```

### Gate Function

```
构造 mock 响应之前：
  自问："真实 API 响应包含哪些字段？"

  动作：
    1. 翻文档 / 实际响应样例
    2. 包含系统下游可能消费的所有字段
    3. 验证 mock 与真实响应 schema 完整一致

  关键：
    如果你在造 mock，你必须理解整个结构
    部分 mock 在代码访问被省略的字段时静默失败

  不确定时：把所有文档化的字段都加上
```

## 反模式 5：把集成测试当事后补救

**违反样例：**
```
✅ 实现完成
❌ 没有测试
"可以测了"
```

**为什么错：**
- 测试是实现的一部分，不是可选的后续
- TDD 本该在前面就拦住这种情况
- 没有测试就不能声称"完成"

**修法：**
```
TDD 循环：
1. 写失败测试
2. 实现使其通过
3. 重构
4. 然后才声称完成
```

## Mock 变得太复杂时

**预警信号**：
- mock 的 setup 比测试逻辑还长
- 为了让测试通过把一切都 mock 了
- mock 缺少真实组件有的方法
- mock 一变，测试就坏

**人类伙伴的反问**：「我们这里真的需要 mock 吗？」

**考虑**：用真实组件写集成测试，通常比维护复杂 mock 更简单。

## TDD 如何阻止这些反模式

**TDD 为什么有效**：
1. **先写测试** → 强迫你想清楚到底在测什么
2. **看它失败** → 确认测试测的是真实行为，不是 mock
3. **最小实现** → 测试专用方法没机会偷偷溜进生产类
4. **真实依赖** → 你在 mock 之前先看到测试到底需要什么

**如果你在测 mock 行为，就违反了 TDD** —— 你在没看到测试针对真实代码失败之前，就加了 mock。

## Quick Reference

| 反模式 | 修法 |
| --- | --- |
| 断言 mock 元素 | 测真组件，或把组件解除 mock |
| 生产类里的测试专用方法 | 挪到测试工具里 |
| 不搞懂就 mock | 先搞懂依赖，再做最小 mock |
| 不完整的 mock | 完整镜像真实 API |
| 测试作为事后补救 | TDD —— 先写测试 |
| Mock 过于复杂 | 考虑用真实组件做集成测试 |

## 红旗

- 断言里检查 `*-mock` 这种 testid
- 方法只在测试文件里被调用
- mock setup 占测试代码的一半以上
- 移除 mock 测试就挂
- 说不清为什么要 mock
- "为了保险先 mock 了"

## 底线

**Mock 是隔离工具，不是被测对象。**

如果 TDD 揭示你在测 mock 行为，你走错路了。

修法：测真实行为，或者反过来问自己为什么要 mock。
