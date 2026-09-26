'use strict';
/*
 * 一次性验收服务（docker compose 中的 verify 服务入口）：
 *   1. 代码测试  —— node --test 运行全部单元测试
 *   2. 构建      —— 全部 JS 语法检查 + 交付物完整性检查（本项目无编译步骤）
 *   3. 健康冒烟  —— GET  /health
 *   4. 校核冒烟  —— POST /api/evaluate：通过样例 / 翻折样例 / 退化样例 / 无效样例
 * 全部通过以退出码 0 报告验收成功，否则退出码 1。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WEB_URL = (process.env.WEB_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log('  ✔ ' + name);
}

function bad(name, detail) {
  failed++;
  failures.push(name);
  console.error('  ✘ ' + name + (detail ? '\n      ' + String(detail).split('\n').join('\n      ') : ''));
}

function check(name, cond, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9);
}

async function getJsonRetry(url, attempts, delayMs) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { __error: String(lastErr && lastErr.message ? lastErr.message : lastErr) };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 保留原文 */ }
  return { status: res.status, json, text };
}

function runUnitTests() {
  console.log('\n== 1/4 代码测试（node --test）==');
  const r = spawnSync(process.execPath, ['--test'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (r.status === 0) {
    ok('单元测试全部通过');
  } else {
    bad('单元测试失败', (r.stdout || '').slice(-2000) + '\n' + (r.stderr || '').slice(-2000));
  }
}

function runBuild() {
  console.log('\n== 2/4 构建（语法与交付物完整性检查）==');
  const jsFiles = ['server.js', 'verify.js', 'public/geometry.js', 'public/app.js', 'test/geometry.test.js'];
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    check('语法检查 ' + f, r.status === 0, r.stderr);
  }
  const required = ['public/index.html', 'public/styles.css', 'Dockerfile', 'docker-compose.yml', 'README.md'];
  for (const f of required) {
    check('交付物存在 ' + f, fs.existsSync(path.join(ROOT, f)));
  }
}

async function runHealthSmoke() {
  console.log('\n== 3/4 健康检查冒烟（' + WEB_URL + '）==');
  const health = await getJsonRetry(WEB_URL + '/health', 30, 1000);
  check('GET /health 可访问且 status=ok', health && health.status === 'ok', JSON.stringify(health));
}

async function runEvaluateSmoke() {
  console.log('\n== 4/4 校核样例冒烟 ==');

  // 样例 A：剪切网格（每行右移行号），应通过；标记 (0.5,0.5) → (1.0,0.5)
  const sampleA = {
    rows: 2, cols: 2,
    nodes: [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
      [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]
    ],
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1.5, y: 1.5 }]
  };
  const a = await postJson(WEB_URL + '/api/evaluate', sampleA);
  check('样例A(通过样例) HTTP 200', a.status === 200, a.text);
  check('样例A ok=true', a.json && a.json.ok === true, a.text);
  check('样例A 全网最小雅可比 Jmin=1', a.json && a.json.minJacobian && a.json.minJacobian.value === 1,
    a.json && JSON.stringify(a.json.minJacobian));
  check('样例A 标记M1换算=(1, 0.5)',
    a.json && a.json.markers && a.json.markers[0] &&
    approx(a.json.markers[0].mapped.x, 1) && approx(a.json.markers[0].mapped.y, 0.5),
    a.json && JSON.stringify(a.json.markers && a.json.markers[0]));
  check('样例A 共享边连续', a.json && a.json.sharedEdges && a.json.sharedEdges.continuous === true,
    a.json && JSON.stringify(a.json.sharedEdges));

  // 样例 B：网结(0,2)被拉回原点 → 单元(0,1) 左上角 J=-1 翻折
  const sampleB = {
    rows: 2, cols: 2,
    nodes: [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
      [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }]
    ],
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  };
  const b = await postJson(WEB_URL + '/api/evaluate', sampleB);
  const bf = b.json && b.json.failure;
  check('样例B(翻折样例) ok=false', b.json && b.json.ok === false, b.text);
  check('样例B 首项失败=单元(0,1)角点0(左上)翻折 J=-1',
    bf && bf.type === 'fold' && bf.cell.row === 0 && bf.cell.col === 1 && bf.corner === 0 && bf.jacobian === -1,
    JSON.stringify(bf));
  check('样例B 不输出失真标记换算', b.json && b.json.markers === undefined, b.text);

  // 样例 C：网结(1,1)与(1,0)重合 → 单元(0,0) 右下角 J=0 退化
  const sampleC = {
    rows: 2, cols: 2,
    nodes: [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 0, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 1 }],
      [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }]
    ],
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  };
  const c = await postJson(WEB_URL + '/api/evaluate', sampleC);
  const cf = c.json && c.json.failure;
  check('样例C(退化样例) ok=false', c.json && c.json.ok === false, c.text);
  check('样例C 首项失败=单元(0,0)角点2(右下)退化 J=0',
    cf && cf.type === 'degenerate' && cf.cell.row === 0 && cf.cell.col === 0 && cf.corner === 2 && cf.jacobian === 0,
    JSON.stringify(cf));

  // 样例 D：网结含非整数坐标 → 无效输入
  const sampleD = {
    rows: 2, cols: 2,
    nodes: [
      [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 2, y: 0 }],
      [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
      [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }]
    ],
    markers: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }]
  };
  const d = await postJson(WEB_URL + '/api/evaluate', sampleD);
  const df = d.json && d.json.failure;
  check('样例D(无效坐标) ok=false 且 type=invalid，定位网结(0,1)',
    d.json && d.json.ok === false && df && df.type === 'invalid' && df.target === 'node' && df.row === 0 && df.col === 1,
    JSON.stringify(df));
}

async function main() {
  console.log('壁毯织补定位网校核 —— 一次性验收开始');
  runUnitTests();
  runBuild();
  await runHealthSmoke();
  await runEvaluateSmoke();

  console.log('\n========================================');
  console.log('验收结果：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed > 0) {
    console.error('失败项：\n  - ' + failures.join('\n  - '));
    console.error('验收结论：不通过（退出码 1）');
    process.exit(1);
  }
  console.log('验收结论：全部通过（退出码 0）');
  process.exit(0);
}

main().catch((e) => {
  console.error('验收过程异常：', e);
  process.exit(1);
});
