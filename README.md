# 壁毯织补定位网校核（Tapestry Grid Checker）

壁毯修复师在浏览器中建立 **2–4 行 × 2–4 列** 矩形单元的定位网，拖动或录入织补后各网结的**整数坐标**，并录入 **3–12 个原网纹样标记**。点击「校核」后，应用把每个单元视为**连续双线性形变**，将标记换算到织补坐标，并对整张网做**连续（非采样）无翻折判定**。

## 判定原理（连续判定，非有限采样）

- 单元双线性映射 `P(u,v) = A + B·u + C·v + D·u·v`，`(u,v) ∈ [0,1]²`。
- 其雅可比行列式展开后 `u·v` 项恒消去：`J(u,v) = J₀₀ + (J₁₀-J₀₀)·u + (J₀₁-J₀₀)·v`，关于 u、v 分别线性。
- 因此 **J 在闭单元上的最小值必在四个角点取得**：四角 `J > 0` ⟺ 单元内部处处 `J > 0`（不翻折、不退化）。网结坐标为整数时 J 必为整数，符号判定精确。
- **相邻单元共享边连续**：结构化网格中相邻单元引用同一对网结，双线性映射限制在共享边上即两端点的线性插值，两侧逐点相同（结构性保证）。
- 失败时按**行优先单元 + 固定角点顺序（左上→右上→右下→左下）**报告首项证据（翻折 `J<0` / 退化 `J=0` / 无效坐标），且**不输出失真的标记换算结果**。
- 网结拖动或任何字段修改后，旧结论**立即失效**（界面显著提示），须重新校核。

浏览器端与服务器共用同一份判定代码 `public/geometry.js`。

## 快速开始（Docker）

```bash
# 启动 Web 服务（默认宿主机端口 8080）
docker compose up --build web

# 宿主机端口可配置
HOST_PORT=9090 docker compose up -d --build web

# 健康检查
curl http://localhost:8080/health
```

## 一次性验收（verify 服务）

`verify` 服务自行运行：① 代码测试（node --test）② 构建检查（语法与交付物完整性）③ 健康检查冒烟 ④ 校核样例冒烟（通过 / 翻折 / 退化 / 无效坐标四组样例），并以**退出码**报告验收结论：

```bash
docker compose up --build --abort-on-container-exit --exit-code-from verify
echo $?   # 0 = 验收通过，1 = 不通过
```

## 本地开发（无 Docker）

```bash
node server.js                 # 启动 Web（PORT 环境变量可改端口，默认 8080）
npm test                       # 单元测试
node server.js &               # 先启动服务
WEB_URL=http://127.0.0.1:8080 node verify.js   # 一次性验收
```

## API

### `GET /health`
返回 `{ "status": "ok", ... }`。

### `POST /api/evaluate`
请求体：

```json
{
  "rows": 2, "cols": 2,
  "nodes": [
    [{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}],
    [{"x":0,"y":1},{"x":1,"y":1},{"x":2,"y":1}],
    [{"x":0,"y":2},{"x":1,"y":2},{"x":2,"y":2}]
  ],
  "markers": [{"x":0.5,"y":0.5},{"x":1,"y":1},{"x":1.5,"y":1.5}]
}
```

- `rows`/`cols`：2–4 的整数；`nodes` 为 `(rows+1)×(cols+1)` 的整数坐标网结（织补后）；`markers` 为 3–12 个原网坐标（实数，范围 `[0,cols]×[0,rows]`）。
- 通过时返回：`ok:true`、`minJacobian`（全网最小雅可比值及其单元/角点位置）、`markers`（每个标记的所在单元、局部坐标与织补坐标）、`cells`（各单元四角 J 明细）、`sharedEdges`（共享边连续核查）。
- 失败时返回：`ok:false`、`failure`（`type` 为 `fold`/`degenerate`/`invalid`，含首项失败位置与原因），**不返回标记换算结果**。索引均为 0 基。

## 项目结构

```
├── Dockerfile            # 一体化镜像（Web + verify 共用，含 HEALTHCHECK）
├── docker-compose.yml    # web 服务 + 一次性 verify 服务，宿主机端口 HOST_PORT 可配
├── package.json
├── server.js             # 静态托管 + /health + /api/evaluate
├── verify.js             # 一次性验收脚本（测试/构建/健康/校核冒烟 → 退出码）
├── public/
│   ├── geometry.js       # 核心判定模块（浏览器与服务器共用，UMD）
│   ├── app.js            # 浏览器端交互（拖网结、录入、校核、失效处理）
│   ├── index.html
│   └── styles.css
└── test/
    └── geometry.test.js  # 单元测试（含角点定理的随机采样对照验证）
```
