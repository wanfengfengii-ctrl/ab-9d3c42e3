/* 壁毯织补定位网校核 —— 浏览器端交互（判定逻辑全部来自 /geometry.js，与服务器共用） */
(function () {
  'use strict';

  var G = window.TapestryGeometry;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var state = {
    rows: 2,
    cols: 2,
    nodes: [],      // nodes[row][col] = {x, y}，织补后整数坐标
    markers: [],    // [{x, y}]，原网坐标
    result: null,   // 最近一次校核结论
    stale: false    // 结论是否已因修改而失效
  };

  var svgEl, resultsEl, staleBadge;
  var drag = null;          // {row, col}
  var frozenViewBox = null; // 拖动期间冻结视野，避免跳动

  /* ---------- 工具 ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    return node;
  }

  function fmt(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    if (Number.isInteger(x)) return String(x);
    var s = x.toFixed(4);
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }

  // 界面展示用 1 基行/列号
  function cellLabel(cell) {
    return '单元(行' + (cell.row + 1) + ', 列' + (cell.col + 1) + ')';
  }

  /* ---------- 状态 ---------- */

  function defaultNodes(rows, cols, prev) {
    var nodes = [];
    for (var i = 0; i <= rows; i++) {
      var r = [];
      for (var j = 0; j <= cols; j++) {
        var p = prev && prev[i] && prev[i][j];
        r.push(p ? { x: p.x, y: p.y } : { x: j, y: i });
      }
      nodes.push(r);
    }
    return nodes;
  }

  function markStale() {
    if (state.result) state.stale = true;
    renderStaleBadge();
    renderResults();
    renderSvg();
  }

  /* ---------- 渲染：画布 ---------- */

  function computeViewBox() {
    var xs = [0, state.cols], ys = [0, state.rows];
    state.nodes.forEach(function (row) {
      row.forEach(function (p) {
        if (isFinite(p.x) && isFinite(p.y)) { xs.push(p.x); ys.push(p.y); }
      });
    });
    state.markers.forEach(function (m) {
      if (isFinite(m.x) && isFinite(m.y)) { xs.push(m.x); ys.push(m.y); }
    });
    var pad = 0.8;
    var minX = Math.min.apply(null, xs) - pad;
    var minY = Math.min.apply(null, ys) - pad;
    var w = Math.max.apply(null, xs) - minX + pad;
    var h = Math.max.apply(null, ys) - minY + pad;
    return { x: minX, y: minY, w: w, h: h };
  }

  function cellStatus(row, col) {
    // 依据当前（未失效的）结论给单元着色
    if (!state.result || state.stale || !state.result.cells) return 'unknown';
    var cells = state.result.cells;
    for (var k = 0; k < cells.length; k++) {
      if (cells[k].row === row && cells[k].col === col) {
        var min = Math.min.apply(null, cells[k].jacobians);
        return min > 0 ? 'ok' : 'bad';
      }
    }
    return 'unknown';
  }

  function renderSvg() {
    var vb = frozenViewBox || computeViewBox();
    svgEl.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    svgEl.textContent = '';

    var i, j;

    // 原网参考（浅灰单位格）
    var g0 = svg('g', {});
    for (i = 0; i <= state.rows; i++) {
      g0.appendChild(svg('line', { x1: 0, y1: i, x2: state.cols, y2: i, stroke: '#e3ddd0', 'stroke-width': 0.02 }));
    }
    for (j = 0; j <= state.cols; j++) {
      g0.appendChild(svg('line', { x1: j, y1: 0, x2: j, y2: state.rows, stroke: '#e3ddd0', 'stroke-width': 0.02 }));
    }
    svgEl.appendChild(g0);

    // 织补单元
    var gCells = svg('g', {});
    for (i = 0; i < state.rows; i++) {
      for (j = 0; j < state.cols; j++) {
        var c = G.cellCorners(state.nodes, i, j);
        var st = cellStatus(i, j);
        var fill = st === 'ok' ? 'rgba(30,125,70,0.14)' : st === 'bad' ? 'rgba(179,38,30,0.18)' : 'rgba(138,90,43,0.10)';
        var pts = c.map(function (p) { return p.x + ',' + p.y; }).join(' ');
        gCells.appendChild(svg('polygon', { points: pts, fill: fill, stroke: '#8a5a2b', 'stroke-width': 0.035, 'stroke-linejoin': 'round' }));
      }
    }
    svgEl.appendChild(gCells);

    // 纹样标记：原位置（空心菱形）
    var gM = svg('g', {});
    state.markers.forEach(function (m, idx) {
      if (!isFinite(m.x) || !isFinite(m.y)) return;
      var d = 0.09;
      gM.appendChild(svg('polygon', {
        points: (m.x) + ',' + (m.y - d) + ' ' + (m.x + d) + ',' + m.y + ' ' + m.x + ',' + (m.y + d) + ' ' + (m.x - d) + ',' + m.y,
        fill: 'none', stroke: '#b07d2b', 'stroke-width': 0.03
      }));
    });
    svgEl.appendChild(gM);

    // 校核通过且结论未失效时：标记的织补坐标（实心点 + 编号 + 位移线）
    if (state.result && !state.stale && state.result.ok) {
      var gMap = svg('g', {});
      state.result.markers.forEach(function (r) {
        var p = r.mapped;
        gMap.appendChild(svg('line', {
          x1: r.input.x, y1: r.input.y, x2: p.x, y2: p.y,
          stroke: '#1e7d46', 'stroke-width': 0.02, 'stroke-dasharray': '0.06 0.05'
        }));
        gMap.appendChild(svg('circle', { cx: p.x, cy: p.y, r: 0.07, fill: '#1e7d46' }));
        var t = svg('text', { x: p.x + 0.1, y: p.y - 0.08, 'font-size': 0.16, fill: '#1e7d46' });
        t.textContent = 'M' + (r.index + 1);
        gMap.appendChild(t);
      });
      svgEl.appendChild(gMap);
    }

    // 网结（可拖动）
    var gN = svg('g', {});
    state.nodes.forEach(function (row, i) {
      row.forEach(function (p, j) {
        if (!isFinite(p.x) || !isFinite(p.y)) return;
        var c = svg('circle', {
          cx: p.x, cy: p.y, r: 0.11,
          fill: '#fff', stroke: '#8a5a2b', 'stroke-width': 0.045,
          'class': 'node', 'data-row': i, 'data-col': j
        });
        gN.appendChild(c);
        var label = svg('text', { x: p.x + 0.14, y: p.y + 0.2, 'font-size': 0.15, fill: '#7a7264', 'pointer-events': 'none' });
        label.textContent = '(' + p.x + ',' + p.y + ')';
        gN.appendChild(label);
      });
    });
    svgEl.appendChild(gN);
  }

  function toSvgPoint(e) {
    var ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    var pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function onPointerDown(e) {
    var t = e.target;
    if (!t.getAttribute || t.getAttribute('class') !== 'node') return;
    drag = { row: +t.getAttribute('data-row'), col: +t.getAttribute('data-col') };
    frozenViewBox = computeViewBox();
    svgEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    var p = toSvgPoint(e);
    if (!p) return;
    var x = Math.round(p.x), y = Math.round(p.y);
    if (Math.abs(x) > G.MAX_COORD) x = Math.sign(x) * G.MAX_COORD;
    if (Math.abs(y) > G.MAX_COORD) y = Math.sign(y) * G.MAX_COORD;
    state.nodes[drag.row][drag.col] = { x: x, y: y };
    syncNodeInputs(drag.row, drag.col);
    markStale();
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    frozenViewBox = null;
    renderSvg();
  }

  /* ---------- 渲染：网结表格 ---------- */

  function renderNodeTable() {
    var wrap = document.getElementById('node-table');
    wrap.textContent = '';
    state.nodes.forEach(function (row, i) {
      row.forEach(function (p, j) {
        var field = el('div', { 'class': 'node-field' });
        field.appendChild(el('span', { 'class': 'tag', text: '结(' + (i + 1) + ',' + (j + 1) + ')' }));
        ['x', 'y'].forEach(function (axis) {
          var input = el('input', { type: 'number', step: '1', 'data-row': i, 'data-col': j, 'data-axis': axis });
          input.value = p[axis];
          input.addEventListener('input', function () {
            var v = input.value.trim() === '' ? NaN : Number(input.value);
            state.nodes[i][j][axis] = v;
            input.classList.toggle('invalid', !Number.isInteger(v));
            markStale();
          });
          field.appendChild(input);
        });
        wrap.appendChild(field);
      });
    });
  }

  function syncNodeInputs(i, j) {
    var p = state.nodes[i][j];
    ['x', 'y'].forEach(function (axis) {
      var input = document.querySelector('#node-table input[data-row="' + i + '"][data-col="' + j + '"][data-axis="' + axis + '"]');
      if (input) {
        input.value = p[axis];
        input.classList.toggle('invalid', !Number.isInteger(p[axis]));
      }
    });
  }

  /* ---------- 渲染：标记 ---------- */

  function renderMarkerTable() {
    var wrap = document.getElementById('marker-table');
    wrap.textContent = '';
    state.markers.forEach(function (m, idx) {
      var row = el('div', { 'class': 'marker-row' });
      row.appendChild(el('span', { 'class': 'idx', text: 'M' + (idx + 1) }));
      ['x', 'y'].forEach(function (axis) {
        var input = el('input', { type: 'number', step: 'any', 'data-idx': idx, 'data-axis': axis, placeholder: axis });
        input.value = m[axis];
        input.addEventListener('input', function () {
          var v = input.value.trim() === '' ? NaN : Number(input.value);
          state.markers[idx][axis] = v;
          input.classList.toggle('invalid', !isFinite(v));
          markStale();
        });
        row.appendChild(input);
      });
      var del = el('button', { type: 'button', 'class': 'btn-danger', text: '删除' });
      del.disabled = state.markers.length <= G.MIN_MARKERS;
      del.addEventListener('click', function () {
        state.markers.splice(idx, 1);
        markStale();
        renderMarkerTable();
      });
      row.appendChild(del);
      wrap.appendChild(row);
    });
    document.getElementById('add-marker').disabled = state.markers.length >= G.MAX_MARKERS;
  }

  /* ---------- 渲染：结果 ---------- */

  function renderStaleBadge() {
    staleBadge.hidden = !(state.result && state.stale);
  }

  function failureText(f) {
    if (f.type === 'fold') {
      return '翻折：' + cellLabel(f.cell) + ' 角点「' + f.cornerName + '」雅可比 J = ' + fmt(f.jacobian) + ' < 0';
    }
    if (f.type === 'degenerate') {
      return '退化：' + cellLabel(f.cell) + ' 角点「' + f.cornerName + '」雅可比 J = 0（单元面积为零）';
    }
    // invalid
    var where = '';
    if (f.target === 'node') where = '网结(行' + (f.row + 1) + ', 列' + (f.col + 1) + ')：';
    else if (f.target === 'marker') where = '标记 M' + (f.index + 1) + '：';
    return '无效坐标/输入：' + where + f.reason;
  }

  function renderResults() {
    var r = state.result;
    resultsEl.textContent = '';

    if (!r) {
      resultsEl.appendChild(el('p', { 'class': 'muted', text: '尚未校核。完成设置后点击「校核」。' }));
      return;
    }

    var dim = state.stale;
    if (dim) {
      resultsEl.appendChild(el('div', {
        'class': 'banner stale',
        text: '结论已失效：网格或标记在校核后被修改，以下仅为失效前的旧结论，不得用于织补。'
      }));
    }

    var box = el('div', { 'class': dim ? 'evidence dimmed' : 'evidence' });
    if (dim) box.style.opacity = '0.45';

    if (!r.ok) {
      box.appendChild(el('div', { 'class': 'banner bad', text: '校核未通过 —— 首项失败证据（行优先单元 + 固定角点顺序）' }));
      var eb = el('div', { 'class': 'evidence-block' });
      eb.appendChild(el('div', { text: failureText(r.failure) }));
      if (r.failure.type !== 'invalid') {
        eb.appendChild(el('div', {
          'class': 'muted',
          text: '已按行优先顺序扫描全部单元、按固定角点顺序（左上→右上→右下→左下）扫描角点，以上为首个 J ≤ 0 的位置。'
        }));
      }
      eb.appendChild(el('div', {
        'class': 'bad',
        text: '已停止换算：为避免把失真的纹样位置交给织补师，本次不提供标记换算结果。'
      }));
      box.appendChild(eb);
      if (r.cells) box.appendChild(cellsTable(r));
      resultsEl.appendChild(box);
      return;
    }

    box.appendChild(el('div', { 'class': 'banner ok', text: '校核通过：全网连续无翻折、无退化，相邻单元共享边连续。' }));

    var mj = r.minJacobian;
    var ev = el('div', { 'class': 'evidence-block' });
    ev.appendChild(el('div', {
      text: '全网最小雅可比证据：Jmin = ' + fmt(mj.value) + '，位于 ' + cellLabel(mj.cell) + ' 角点「' + mj.cornerName + '」。'
    }));
    ev.appendChild(el('div', {
      'class': 'muted',
      text: '依据角点定理：双线性映射的 J(u,v) 关于 u、v 分别线性，最小值必在角点取得；四角 J > 0 即全单元内部处处 J > 0（连续判定，非采样）。'
    }));
    ev.appendChild(el('div', {
      'class': 'muted',
      text: '共享边连续：共 ' + r.sharedEdges.count + ' 条内部边，相邻单元引用同一对网结，边上双线性映射退化为同一线性插值，逐点相同。'
    }));
    box.appendChild(ev);

    // 标记换算表
    var mt = el('table', { 'class': 'data' });
    mt.appendChild(el('tr', {}, [
      el('th', { text: '标记' }), el('th', { text: '原网坐标' }), el('th', { text: '所在单元' }),
      el('th', { text: '局部 (u, v)' }), el('th', { text: '织补坐标' })
    ]));
    r.markers.forEach(function (m) {
      mt.appendChild(el('tr', {}, [
        el('td', { text: 'M' + (m.index + 1) }),
        el('td', { text: '(' + fmt(m.input.x) + ', ' + fmt(m.input.y) + ')' }),
        el('td', { text: '行' + (m.cell.row + 1) + ' 列' + (m.cell.col + 1) }),
        el('td', { text: '(' + fmt(m.local.u) + ', ' + fmt(m.local.v) + ')' }),
        el('td', { 'class': 'good', text: '(' + fmt(m.mapped.x) + ', ' + fmt(m.mapped.y) + ')' })
      ]));
    });
    box.appendChild(el('h3', { text: '纹样标记换算（原网 → 织补）' }));
    box.appendChild(mt);

    box.appendChild(el('h3', { text: '各单元角点雅可比明细' }));
    box.appendChild(cellsTable(r));
    resultsEl.appendChild(box);
  }

  function cellsTable(r) {
    var t = el('table', { 'class': 'data' });
    var head = el('tr', {}, [el('th', { text: '单元' })].concat(
      G.CORNER_NAMES.map(function (n) { return el('th', { text: 'J·' + n }); })
    ));
    t.appendChild(head);
    r.cells.forEach(function (c) {
      var tr = el('tr', {}, [el('td', { text: '行' + (c.row + 1) + ' 列' + (c.col + 1) })]);
      c.jacobians.forEach(function (J) {
        tr.appendChild(el('td', { 'class': J > 0 ? 'good' : 'bad', text: fmt(J) }));
      });
      t.appendChild(tr);
    });
    return t;
  }

  /* ---------- 校核 ---------- */

  function onVerify() {
    state.result = G.evaluateGrid({
      rows: state.rows,
      cols: state.cols,
      nodes: state.nodes,
      markers: state.markers
    });
    state.stale = false;
    renderStaleBadge();
    renderResults();
    renderSvg();
  }

  /* ---------- 初始化 ---------- */

  function renderAll() {
    renderSvg();
    renderNodeTable();
    renderMarkerTable();
    renderStaleBadge();
    renderResults();
  }

  function init() {
    svgEl = document.getElementById('grid-svg');
    resultsEl = document.getElementById('results');
    staleBadge = document.getElementById('stale-badge');

    state.nodes = defaultNodes(2, 2);
    state.markers = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1, y: 1.5 }];

    var rowsSel = document.getElementById('rows-select');
    var colsSel = document.getElementById('cols-select');
    rowsSel.value = String(state.rows);
    colsSel.value = String(state.cols);
    rowsSel.addEventListener('change', function () {
      state.rows = +rowsSel.value;
      state.nodes = defaultNodes(state.rows, state.cols, state.nodes);
      markStale();
      renderNodeTable();
    });
    colsSel.addEventListener('change', function () {
      state.cols = +colsSel.value;
      state.nodes = defaultNodes(state.rows, state.cols, state.nodes);
      markStale();
      renderNodeTable();
    });

    document.getElementById('add-marker').addEventListener('click', function () {
      if (state.markers.length >= G.MAX_MARKERS) return;
      state.markers.push({ x: 0.5, y: 0.5 });
      markStale();
      renderMarkerTable();
    });

    document.getElementById('verify-btn').addEventListener('click', onVerify);

    svgEl.addEventListener('pointerdown', onPointerDown);
    svgEl.addEventListener('pointermove', onPointerMove);
    svgEl.addEventListener('pointerup', onPointerUp);
    svgEl.addEventListener('pointercancel', onPointerUp);

    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
