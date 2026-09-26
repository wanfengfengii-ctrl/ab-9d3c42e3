'use strict';
/*
 * 核心几何模块单元测试（node:test）。
 * 注意：应用中禁止以采样代替连续判定；此处测试反向使用密集采样，
 * 仅为从经验上验证「角点定理」——J 在闭单元上的最小值恰在角点取得。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/geometry.js');

function identityNodes(rows, cols) {
  const nodes = [];
  for (let i = 0; i <= rows; i++) {
    const r = [];
    for (let j = 0; j <= cols; j++) r.push({ x: j, y: i });
    nodes.push(r);
  }
  return nodes;
}

function shearNodes(rows, cols) {
  // 每行向右平移行号：纯剪切，面积保持
  const nodes = [];
  for (let i = 0; i <= rows; i++) {
    const r = [];
    for (let j = 0; j <= cols; j++) r.push({ x: j + i, y: i });
    nodes.push(r);
  }
  return nodes;
}

test('单位格双线性映射为恒等映射', () => {
  const k = G.bilinearCoeffs({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 });
  assert.deepEqual(G.mapPoint(k, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(G.mapPoint(k, 1, 1), { x: 1, y: 1 });
  assert.deepEqual(G.mapPoint(k, 0.3, 0.7), { x: 0.3, y: 0.7 });
});

test('单位格雅可比恒为 1；整数网结的 J 必为整数', () => {
  const js = G.cellCornerJacobians([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  assert.deepEqual(js, [1, 1, 1, 1]);
  const quad = [{ x: -3, y: 2 }, { x: 5, y: -1 }, { x: 7, y: 8 }, { x: 0, y: 4 }];
  for (const J of G.cellCornerJacobians(quad)) assert.ok(Number.isInteger(J));
});

test('角点定理：J 在闭单元上的最小值恰在角点（随机整数四边形 + 密集采样对照）', () => {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  for (let t = 0; t < 300; t++) {
    const corners = [0, 1, 2, 3].map(() => ({
      x: Math.floor(rnd() * 21) - 10,
      y: Math.floor(rnd() * 21) - 10
    }));
    const k = G.bilinearCoeffs(...corners);
    const cornerMin = Math.min(...G.cellCornerJacobians(corners));
    let sampledMin = Infinity;
    for (let iu = 0; iu <= 50; iu++) {
      for (let iv = 0; iv <= 50; iv++) {
        const J = G.jacobianAt(k, iu / 50, iv / 50);
        if (J < sampledMin) sampledMin = J;
      }
    }
    assert.ok(Math.abs(sampledMin - cornerMin) < 1e-9,
      `t=${t}: 采样最小 ${sampledMin} ≠ 角点最小 ${cornerMin}`);
  }
});

test('恒等网格校核通过：minJ=1，标记换算即自身', () => {
  const r = G.evaluateGrid({
    rows: 2, cols: 2,
    nodes: identityNodes(2, 2),
    markers: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.25 }, { x: 2, y: 2 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.minJacobian.value, 1);
  assert.deepEqual(r.minJacobian.cell, { row: 0, col: 0 });
  assert.equal(r.minJacobian.corner, 0);
  assert.equal(r.markers.length, 3);
  for (const m of r.markers) {
    assert.ok(Math.abs(m.mapped.x - m.input.x) < 1e-12);
    assert.ok(Math.abs(m.mapped.y - m.input.y) < 1e-12);
  }
  // 边界标记 (2,2) 应被钳入末单元角点
  assert.deepEqual(r.markers[2].cell, { row: 1, col: 1 });
  assert.deepEqual(r.markers[2].local, { u: 1, v: 1 });
});

test('剪切网格校核通过：标记按双线性映射换算', () => {
  const r = G.evaluateGrid({
    rows: 2, cols: 2,
    nodes: shearNodes(2, 2),
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.minJacobian.value, 1);
  // 单元(0,0) 角点 (0,0),(1,0),(2,1),(1,1)：P(0.5,0.5) = (1.0, 0.5)
  assert.ok(Math.abs(r.markers[0].mapped.x - 1.0) < 1e-12);
  assert.ok(Math.abs(r.markers[0].mapped.y - 0.5) < 1e-12);
});

test('共享边连续：跨边标记在两侧单元映射到同一点', () => {
  const nodes = shearNodes(2, 2);
  // x=1 为两列共享边：分别按左单元(u=1)与右单元(u=0)计算
  const left = G.mapMarker(2, 2, nodes, { x: 1 - 1e-12, y: 0.5 });
  const right = G.mapMarker(2, 2, nodes, { x: 1, y: 0.5 });
  assert.deepEqual(left.cell, { row: 0, col: 0 });
  assert.deepEqual(right.cell, { row: 0, col: 1 });
  assert.ok(Math.abs(left.mapped.x - right.mapped.x) < 1e-9);
  assert.ok(Math.abs(left.mapped.y - right.mapped.y) < 1e-9);
  // 共享边结构性核查
  const shared = G.checkSharedEdges(2, 2, nodes);
  assert.equal(shared.continuous, true);
  assert.equal(shared.count, 2 * (2 * (2 - 1))); // 水平+垂直内部边
});

test('共享边连续（数值）：相邻单元边上逐点一致', () => {
  const nodes = [
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 1 }],
    [{ x: 0, y: 2 }, { x: 2, y: 1 }, { x: 4, y: 3 }],
    [{ x: 1, y: 4 }, { x: 2, y: 3 }, { x: 5, y: 4 }]
  ];
  for (const v of [0, 1 / 3, 0.5, 2 / 3, 1]) {
    // 单元(0,0)右边 与 单元(0,1)左边
    const ca = G.cellCorners(nodes, 0, 0);
    const cb = G.cellCorners(nodes, 0, 1);
    const pa = G.mapPoint(G.bilinearCoeffs(...ca), 1, v);
    const pb = G.mapPoint(G.bilinearCoeffs(...cb), 0, v);
    assert.ok(Math.abs(pa.x - pb.x) < 1e-12 && Math.abs(pa.y - pb.y) < 1e-12);
    // 单元(0,0)底边 与 单元(1,0)顶边
    const cc = G.cellCorners(nodes, 1, 0);
    const pc = G.mapPoint(G.bilinearCoeffs(...ca), v, 1);
    const pd = G.mapPoint(G.bilinearCoeffs(...cc), v, 0);
    assert.ok(Math.abs(pc.x - pd.x) < 1e-12 && Math.abs(pc.y - pd.y) < 1e-12);
  }
});

test('翻折：首项失败证据按行优先单元与固定角点顺序给出', () => {
  const nodes = identityNodes(2, 2);
  nodes[0][2] = { x: 0, y: 0 }; // 单元(0,1) 左上角被拉回，J = -1
  const r = G.evaluateGrid({
    rows: 2, cols: 2, nodes,
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'fold');
  assert.deepEqual(r.failure.cell, { row: 0, col: 1 });
  assert.equal(r.failure.corner, 0);
  assert.equal(r.failure.cornerName, '左上');
  assert.equal(r.failure.jacobian, -1);
  assert.equal(r.markers, undefined, '失败时不得输出标记换算结果');
});

test('退化：共线角点 J=0 被识别为退化', () => {
  const nodes = identityNodes(2, 2);
  nodes[1][1] = { x: 0, y: 1 }; // 单元(0,0) 右下角与左下角重合 → J(1,1)=0
  const r = G.evaluateGrid({
    rows: 2, cols: 2, nodes,
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'degenerate');
  assert.deepEqual(r.failure.cell, { row: 0, col: 0 });
  assert.equal(r.failure.corner, 2); // 固定顺序 TL,TR,BR,BL 中首个 J≤0 为右下
  assert.equal(r.failure.cornerName, '右下');
  assert.equal(r.failure.jacobian, 0);
});

test('行优先顺序：多个失败单元时报告行优先的首个', () => {
  const nodes = identityNodes(2, 2);
  nodes[0][2] = { x: 0, y: 0 }; // 单元(0,1) 翻折
  nodes[2][0] = { x: 2, y: 2 }; // 单元(1,0) 也翻折
  const r = G.evaluateGrid({
    rows: 2, cols: 2, nodes,
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failure.cell, { row: 0, col: 1 });
});

test('全网最小雅可比证据：值与位置（行优先+角点顺序打破并列）', () => {
  // 单元(0,0) 的 J(u,v)=2-v：角点值 [2,2,1,1]，最小值首现于角点 2（右下）
  const nodes = [
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }],
    [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 4, y: 1 }],
    [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 4, y: 2 }]
  ];
  const r = G.evaluateGrid({
    rows: 2, cols: 2, nodes,
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.minJacobian.value, 1);
  assert.deepEqual(r.minJacobian.cell, { row: 0, col: 0 });
  assert.equal(r.minJacobian.corner, 2);
  assert.equal(r.minJacobian.cornerName, '右下');
});

test('无效输入：网格尺寸越界或非整数', () => {
  const base = { nodes: identityNodes(2, 2), markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }] };
  for (const [rows, cols] of [[1, 2], [5, 2], [2, 1], [2, 5], [2.5, 2], [2, '2']]) {
    const r = G.evaluateGrid({ rows, cols, nodes: base.nodes, markers: base.markers });
    assert.equal(r.ok, false, `rows=${rows} cols=${cols}`);
    assert.equal(r.failure.type, 'invalid');
  }
});

test('无效输入：网结坐标必须为整数', () => {
  const nodes = identityNodes(2, 2);
  nodes[0][1] = { x: 0.5, y: 0 };
  const r = G.evaluateGrid({
    rows: 2, cols: 2, nodes,
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'invalid');
  assert.equal(r.failure.target, 'node');
  assert.deepEqual({ row: r.failure.row, col: r.failure.col }, { row: 0, col: 1 });
});

test('无效输入：标记数量须为 3~12', () => {
  const nodes = identityNodes(2, 2);
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ x: 0.1 * i + 0.1, y: 0.5 }));
  assert.equal(G.evaluateGrid({ rows: 2, cols: 2, nodes, markers: mk(2) }).failure.type, 'invalid');
  assert.equal(G.evaluateGrid({ rows: 2, cols: 2, nodes, markers: mk(13) }).failure.type, 'invalid');
  assert.equal(G.evaluateGrid({ rows: 2, cols: 2, nodes, markers: mk(3) }).ok, true);
  assert.equal(G.evaluateGrid({ rows: 2, cols: 2, nodes, markers: mk(12) }).ok, true);
});

test('无效输入：标记超出原网范围或为非数值', () => {
  const nodes = identityNodes(2, 2);
  const good = [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }];
  for (const bad of [{ x: -0.1, y: 0.5 }, { x: 2.1, y: 0.5 }, { x: 1, y: 2.1 }, { x: NaN, y: 0 }, { x: 1, y: 'a' }]) {
    const r = G.evaluateGrid({ rows: 2, cols: 2, nodes, markers: [good[0], good[1], bad] });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.failure.type, 'invalid');
    assert.equal(r.failure.target, 'marker');
    assert.equal(r.failure.index, 2);
  }
});

test('无效输入：结构残缺不抛异常，返回 invalid', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { rows: 2, cols: 2 }, { rows: 2, cols: 2, nodes: [], markers: [] }]) {
    const r = G.evaluateGrid(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.failure.type, 'invalid');
  }
});

test('最大网格 4×4 校核通过', () => {
  const r = G.evaluateGrid({
    rows: 4, cols: 4,
    nodes: identityNodes(4, 4),
    markers: [{ x: 0.5, y: 0.5 }, { x: 4, y: 4 }, { x: 2.5, y: 3.5 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.cells.length, 16);
  assert.equal(r.minJacobian.value, 1);
});
