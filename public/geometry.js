/*
 * 壁毯织补定位网 —— 连续双线性形变校核核心模块（浏览器与 Node.js 共用，UMD）。
 *
 * 数学依据（连续判定，非有限采样）：
 *   单元双线性映射  P(u,v) = A + B·u + C·v + D·u·v，(u,v) ∈ [0,1]²。
 *   其雅可比行列式 J(u,v) = ∂P/∂u × ∂P/∂v 展开后 u·v 项恒消去：
 *       J(u,v) = J(0,0) + (J(1,0)-J(0,0))·u + (J(0,1)-J(0,0))·v
 *   即 J 关于 u、v 分别线性，故 J 在闭单位正方形上的最小值必在某个角点取得：
 *       min J = min{ J(0,0), J(1,0), J(1,1), J(0,1) }
 *   因此「四个角点 J 均严格为正」⟺「单元内部处处 J > 0（不翻折、不退化）」。
 *   网结坐标为整数时 J 必为整数，符号判定精确，无需任何误差容限。
 *
 * 相邻单元连续性：结构化网格中相邻单元共享同一对网结对象，双线性映射在共享边
 * 上退化为两端点的线性插值，两侧表达式完全相同，故跨边连续是结构性保证。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TapestryGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 固定角点顺序：左上(TL) → 右上(TR) → 右下(BR) → 左下(BL)
  var CORNER_NAMES = ['左上', '右上', '右下', '左下'];
  var CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

  var MIN_SIZE = 2;
  var MAX_SIZE = 4;
  var MIN_MARKERS = 3;
  var MAX_MARKERS = 12;
  var MAX_COORD = 1000000; // 网结坐标允许范围 ±1e6

  /** 双线性系数：P(u,v) = A + B·u + C·v + D·u·v */
  function bilinearCoeffs(c0, c1, c2, c3) {
    return {
      ax: c0.x, ay: c0.y,
      bx: c1.x - c0.x, by: c1.y - c0.y,
      cx: c3.x - c0.x, cy: c3.y - c0.y,
      dx: c2.x - c1.x - c3.x + c0.x, dy: c2.y - c1.y - c3.y + c0.y
    };
  }

  /** 双线性映射求值 */
  function mapPoint(k, u, v) {
    return {
      x: k.ax + k.bx * u + k.cx * v + k.dx * u * v,
      y: k.ay + k.by * u + k.cy * v + k.dy * u * v
    };
  }

  /** (u,v) 处雅可比行列式 J = ∂P/∂u × ∂P/∂v */
  function jacobianAt(k, u, v) {
    var pxu = k.bx + k.dx * v; // ∂P/∂u
    var pyu = k.by + k.dy * v;
    var pxv = k.cx + k.dx * u; // ∂P/∂v
    var pyv = k.cy + k.dy * u;
    return pxu * pyv - pyu * pxv;
  }

  /** 单元 (i,j) 的四个角点，按固定顺序 TL,TR,BR,BL 取自共享网结数组 */
  function cellCorners(nodes, i, j) {
    return [nodes[i][j], nodes[i][j + 1], nodes[i + 1][j + 1], nodes[i + 1][j]];
  }

  /** 单元四角雅可比值（固定角点顺序）。由角点定理，其最小值即全单元连续最小值 */
  function cellCornerJacobians(corners) {
    var k = bilinearCoeffs(corners[0], corners[1], corners[2], corners[3]);
    return CORNER_UV.map(function (uv) { return jacobianAt(k, uv[0], uv[1]); });
  }

  function samePoint(a, b) {
    return a === b || (a && b && a.x === b.x && a.y === b.y);
  }

  /**
   * 相邻单元共享边连续性核查（结构性）：
   * 水平相邻单元 (i,j)|(i,j+1)：左单元右边端点 TR/BR 与右单元左边端点 TL/BL
   * 必须引用同一对网结；垂直相邻单元 (i,j)|(i+1,j)：上单元底边 BL/BR 与
   * 下单元顶边 TL/TR 同理。双线性映射限制在共享边上即两端点的线性插值，
   * 端点相同则两侧对任意参数逐点相同 —— 跨边连续为结构性保证。
   */
  function checkSharedEdges(rows, cols, nodes) {
    var edges = [];
    var i, j, ca, cb, ok;
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols - 1; j++) {
        ca = cellCorners(nodes, i, j);       // [TL,TR,BR,BL]
        cb = cellCorners(nodes, i, j + 1);
        ok = samePoint(ca[1], cb[0]) && samePoint(ca[2], cb[3]); // 右边 = 左边
        edges.push({ between: [[i, j], [i, j + 1]], sharedNodes: [[i, j + 1], [i + 1, j + 1]], continuous: ok });
      }
    }
    for (i = 0; i < rows - 1; i++) {
      for (j = 0; j < cols; j++) {
        ca = cellCorners(nodes, i, j);
        cb = cellCorners(nodes, i + 1, j);
        ok = samePoint(ca[3], cb[0]) && samePoint(ca[2], cb[1]); // 底边 = 顶边
        edges.push({ between: [[i, j], [i + 1, j]], sharedNodes: [[i + 1, j], [i + 1, j + 1]], continuous: ok });
      }
    }
    var continuous = edges.every(function (e) { return e.continuous; });
    return { count: edges.length, continuous: continuous, edges: edges };
  }

  /** 原网坐标 → 织补坐标：定位所在单元与局部坐标 (u,v)，再做双线性映射 */
  function mapMarker(rows, cols, nodes, m) {
    var col = Math.min(Math.floor(m.x), cols - 1);
    var row = Math.min(Math.floor(m.y), rows - 1);
    var u = m.x - col;
    var v = m.y - row;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    var corners = cellCorners(nodes, row, col);
    var k = bilinearCoeffs(corners[0], corners[1], corners[2], corners[3]);
    var p = mapPoint(k, u, v);
    return {
      input: { x: m.x, y: m.y },
      cell: { row: row, col: col },
      local: { u: u, v: v },
      mapped: { x: p.x, y: p.y }
    };
  }

  function inv(reason, target, extra) {
    var f = { type: 'invalid', reason: reason };
    if (target) f.target = target;
    if (extra) { for (var k in extra) f[k] = extra[k]; }
    return f;
  }

  /** 输入校验，按确定顺序（网格 → 网结行优先 → 标记录入顺序）返回首项无效证据 */
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return inv('请求必须是包含 rows/cols/nodes/markers 的对象', 'input');
    }
    var rows = input.rows, cols = input.cols;
    if (!Number.isInteger(rows) || rows < MIN_SIZE || rows > MAX_SIZE) {
      return inv('行数必须是 ' + MIN_SIZE + '~' + MAX_SIZE + ' 的整数，收到: ' + String(rows), 'grid');
    }
    if (!Number.isInteger(cols) || cols < MIN_SIZE || cols > MAX_SIZE) {
      return inv('列数必须是 ' + MIN_SIZE + '~' + MAX_SIZE + ' 的整数，收到: ' + String(cols), 'grid');
    }
    var nodes = input.nodes;
    if (!Array.isArray(nodes) || nodes.length !== rows + 1) {
      return inv('网结数组应含 ' + (rows + 1) + ' 行', 'nodes');
    }
    for (var i = 0; i <= rows; i++) {
      var rowArr = nodes[i];
      if (!Array.isArray(rowArr) || rowArr.length !== cols + 1) {
        return inv('网结第 ' + i + ' 行应含 ' + (cols + 1) + ' 个节点', 'nodes');
      }
      for (var j = 0; j <= cols; j++) {
        var p = rowArr[j];
        if (!p || typeof p !== 'object') {
          return inv('网结坐标缺失或非对象', 'node', { row: i, col: j });
        }
        if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
          return inv('网结坐标必须为整数，收到: (' + String(p.x) + ', ' + String(p.y) + ')', 'node', { row: i, col: j });
        }
        if (Math.abs(p.x) > MAX_COORD || Math.abs(p.y) > MAX_COORD) {
          return inv('网结坐标超出允许范围 ±' + MAX_COORD, 'node', { row: i, col: j });
        }
      }
    }
    var markers = input.markers;
    if (!Array.isArray(markers) || markers.length < MIN_MARKERS || markers.length > MAX_MARKERS) {
      return inv('纹样标记数量须在 ' + MIN_MARKERS + '~' + MAX_MARKERS + ' 之间，收到: ' +
        (Array.isArray(markers) ? markers.length : String(markers)), 'markers');
    }
    for (var k = 0; k < markers.length; k++) {
      var m = markers[k];
      if (!m || typeof m !== 'object' ||
          typeof m.x !== 'number' || typeof m.y !== 'number' ||
          !isFinite(m.x) || !isFinite(m.y)) {
        return inv('标记坐标必须为有限数值，收到: (' + String(m && m.x) + ', ' + String(m && m.y) + ')', 'marker', { index: k });
      }
      if (m.x < 0 || m.x > cols || m.y < 0 || m.y > rows) {
        return inv('标记坐标超出原网范围 [0,' + cols + ']×[0,' + rows + ']，收到: (' + m.x + ', ' + m.y + ')', 'marker', { index: k });
      }
    }
    return null;
  }

  /**
   * 全网校核。
   * 返回 ok:true  —— { ok, minJacobian:{value,cell,corner,cornerName}, markers, cells, sharedEdges }
   * 返回 ok:false —— { ok, failure:{type:'fold'|'degenerate'|'invalid', ...}, cells? }
   * 失败证据按「行优先单元 + 固定角点顺序」的首项给出。
   */
  function evaluateGrid(input) {
    try {
      var invalid = validate(input);
      if (invalid) return { ok: false, failure: invalid };

      var rows = input.rows, cols = input.cols;
      var nodes = input.nodes, markers = input.markers;

      var cells = [];
      var minJ = Infinity, minCell = null, minCorner = -1;
      var firstFailure = null;

      for (var i = 0; i < rows; i++) {
        for (var j = 0; j < cols; j++) {
          var js = cellCornerJacobians(cellCorners(nodes, i, j));
          cells.push({ row: i, col: j, jacobians: js });
          for (var c = 0; c < 4; c++) {
            var J = js[c];
            if (J < minJ) { minJ = J; minCell = { row: i, col: j }; minCorner = c; }
            if (!firstFailure && J <= 0) {
              firstFailure = {
                type: J < 0 ? 'fold' : 'degenerate',
                cell: { row: i, col: j },
                corner: c,
                cornerName: CORNER_NAMES[c],
                jacobian: J
              };
            }
          }
        }
      }

      if (firstFailure) return { ok: false, failure: firstFailure, cells: cells };

      var mapped = markers.map(function (m, idx) {
        var r = mapMarker(rows, cols, nodes, m);
        r.index = idx;
        return r;
      });

      return {
        ok: true,
        minJacobian: { value: minJ, cell: minCell, corner: minCorner, cornerName: CORNER_NAMES[minCorner] },
        markers: mapped,
        cells: cells,
        sharedEdges: checkSharedEdges(rows, cols, nodes)
      };
    } catch (e) {
      return { ok: false, failure: { type: 'invalid', target: 'input', reason: '内部错误: ' + (e && e.message ? e.message : String(e)) } };
    }
  }

  return {
    CORNER_NAMES: CORNER_NAMES,
    CORNER_UV: CORNER_UV,
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    MIN_MARKERS: MIN_MARKERS,
    MAX_MARKERS: MAX_MARKERS,
    MAX_COORD: MAX_COORD,
    bilinearCoeffs: bilinearCoeffs,
    mapPoint: mapPoint,
    jacobianAt: jacobianAt,
    cellCorners: cellCorners,
    cellCornerJacobians: cellCornerJacobians,
    checkSharedEdges: checkSharedEdges,
    mapMarker: mapMarker,
    evaluateGrid: evaluateGrid
  };
});
