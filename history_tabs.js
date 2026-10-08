/* history_tabs.js — 대시보드 기록 탭 (매매일지·매도실현손익·일자별실현손익·예탁자산증감·수익률추이)
   history.json(같은 폴더)을 읽어 계좌·일/월·기간 필터로 표시. history_collector.py가 함께 업로드합니다. */
(function () {
  "use strict";

  var TABS = [
    { id: "holdings", label: "보유현황" },
    { id: "journal", label: "매매일지" },
    { id: "realized", label: "매도실현손익" },
    { id: "daily", label: "일자별 실현손익" },
    { id: "asset", label: "예탁자산 증감" },
    { id: "return", label: "수익률 추이" }
  ];
  var DATA = null, LOADING = false, LOAD_ERR = "";
  var S = { tab: "holdings", unit: "day", from: "", to: "", preset: "1m" };

  // ── 저장소 (실패해도 동작) ──
  function load(k, d) { try { var v = localStorage.getItem("ht_" + k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem("ht_" + k, v); } catch (e) {} }

  // ── 형식 ──
  function won(v) { return v === null || v === undefined || isNaN(v) ? "-" : Math.round(v).toLocaleString("ko-KR"); }
  function pct(v, d) { return v === null || v === undefined || isNaN(v) ? "-" : (v > 0 ? "+" : "") + v.toFixed(d === undefined ? 2 : d) + "%"; }
  function cls(v) { return v > 0 ? "up" : (v < 0 ? "down" : ""); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function iso(d) { var m = d.getMonth() + 1, x = d.getDate(); return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (x < 10 ? "0" : "") + x; }
  function keyOf(date) { return S.unit === "month" ? date.slice(0, 7) : date; }
  function account() { var s = document.getElementById("accountSelect"); return s ? s.value : ""; }
  function acc() { return DATA && DATA.accounts ? DATA.accounts[account()] : null; }
  function nameOf(code) { return (DATA && DATA.names && DATA.names[code]) || code; }
  function inRange(date) { return (!S.from || date >= S.from) && (!S.to || date <= S.to); }

  function presetRange(p) {
    var t = new Date(), f = new Date(t);
    if (p === "today") { }
    else if (p === "1w") f.setDate(t.getDate() - 7);
    else if (p === "1m") f.setMonth(t.getMonth() - 1);
    else if (p === "3m") f.setMonth(t.getMonth() - 3);
    else if (p === "6m") f.setMonth(t.getMonth() - 6);
    else if (p === "1y") f.setFullYear(t.getFullYear() - 1);
    return [iso(f), iso(t)];
  }

  // ── 스타일 ──
  function injectStyle() {
    var css = [
      ".ht-tabs{display:flex;gap:4px;overflow-x:auto;margin:0 0 14px;border-bottom:2px solid #3b4ab0;-webkit-overflow-scrolling:touch}",
      ".ht-tab{flex:0 0 auto;padding:9px 14px;border:none;background:#e8eaf6;color:#3b4ab0;border-radius:8px 8px 0 0;cursor:pointer;font-size:14px;white-space:nowrap}",
      ".ht-tab.on{background:#3b4ab0;color:#fff;font-weight:bold}",
      ".ht-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#fff;padding:10px 12px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:12px;font-size:13px}",
      ".ht-bar input[type=date],.ht-bar select{padding:5px 6px;border:1px solid #ccc;border-radius:6px;font-size:13px}",
      ".ht-seg{display:inline-flex;border:1px solid #3b4ab0;border-radius:6px;overflow:hidden}",
      ".ht-seg button{border:none;background:#fff;color:#3b4ab0;padding:5px 10px;cursor:pointer;font-size:13px}",
      ".ht-seg button.on{background:#3b4ab0;color:#fff}",
      ".ht-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px}",
      ".ht-sum>div{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:10px;text-align:center}",
      ".ht-sum .k{font-size:12px;color:#888}.ht-sum .v{font-size:16px;font-weight:bold;margin-top:4px}",
      ".ht-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);background:#fff}",
      ".ht-wrap table{box-shadow:none;margin:0;width:100%}",
      ".ht-wrap th,.ht-wrap td{white-space:nowrap}",
      ".ht-wrap tr.total td{background:#f5f6fb;font-weight:bold}",
      ".ht-note{font-size:12px;color:#999;margin-top:8px;line-height:1.6}",
      ".ht-msg{padding:24px;text-align:center;color:#888;background:#fff;border-radius:8px}",
      ".ht-chart{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:8px 8px 4px;margin-bottom:12px}",
      ".ht-chart svg{width:100%;height:180px;display:block}",
      "@media (max-width:760px){.ht-wrap th,.ht-wrap td{padding:7px 9px;font-size:12px}.ht-sum{grid-template-columns:repeat(2,1fr)}}"
    ].join("\n");
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }

  // ── 탭 틀 ──
  function buildShell() {
    var holdings = document.getElementById("tab-holdings");
    if (!holdings) return false;
    var bar = document.createElement("div");
    bar.className = "ht-tabs";
    TABS.forEach(function (t) {
      var b = document.createElement("button");
      b.className = "ht-tab"; b.textContent = t.label; b.setAttribute("data-tab", t.id);
      b.onclick = function () { setTab(t.id); };
      bar.appendChild(b);
    });
    holdings.parentNode.insertBefore(bar, holdings);
    var box = document.createElement("div");
    box.id = "tab-history"; box.style.display = "none";
    holdings.parentNode.insertBefore(box, holdings.nextSibling);
    var sel = document.getElementById("accountSelect");
    if (sel) sel.addEventListener("change", function () { if (S.tab !== "holdings") render(); });
    return true;
  }

  function setTab(id) {
    S.tab = id; save("tab", id);
    document.querySelectorAll(".ht-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === id); });
    document.getElementById("tab-holdings").style.display = id === "holdings" ? "" : "none";
    document.getElementById("tab-history").style.display = id === "holdings" ? "none" : "";
    if (id !== "holdings") { if (!DATA) fetchData(); else render(); }
  }

  function fetchData() {
    if (LOADING) return;
    LOADING = true;
    document.getElementById("tab-history").innerHTML = "<div class='ht-msg'>기록을 불러오는 중…</div>";
    fetch("history.json?t=" + Date.now()).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) { DATA = j; LOADING = false; render(); })
      .catch(function (e) {
        LOADING = false; LOAD_ERR = String(e);
        document.getElementById("tab-history").innerHTML =
          "<div class='ht-msg'>기록 파일(history.json)을 불러오지 못했습니다.<br>" + esc(LOAD_ERR) +
          "<br><small>PC에서 파일을 직접 연 경우에는 표시되지 않습니다. 웹 주소(GitHub Pages)로 열어 주세요.</small></div>";
      });
  }

  // ── 필터 막대 ──
  function filterBar() {
    function seg(name, items, cur) {
      return "<span class='ht-seg'>" + items.map(function (it) {
        return "<button data-" + name + "='" + it[0] + "' class='" + (it[0] === cur ? "on" : "") + "'>" + it[1] + "</button>";
      }).join("") + "</span>";
    }
    return "<div class='ht-bar'>" +
      seg("unit", [["day", "일"], ["month", "월"]], S.unit) +
      "<span>매매일</span><input type='date' id='htFrom' value='" + S.from + "'> ~ <input type='date' id='htTo' value='" + S.to + "'>" +
      seg("preset", [["today", "오늘"], ["1w", "1주"], ["1m", "1개월"], ["3m", "3개월"], ["6m", "6개월"], ["1y", "1년"]], S.preset) +
      "</div>";
  }

  function bindBar(box) {
    box.querySelectorAll("[data-unit]").forEach(function (b) {
      b.onclick = function () { S.unit = b.getAttribute("data-unit"); save("unit", S.unit); render(); };
    });
    box.querySelectorAll("[data-preset]").forEach(function (b) {
      b.onclick = function () {
        S.preset = b.getAttribute("data-preset"); var r = presetRange(S.preset);
        S.from = r[0]; S.to = r[1]; save("preset", S.preset); render();
      };
    });
    ["htFrom", "htTo"].forEach(function (id) {
      var el = box.querySelector("#" + id);
      el.onchange = function () { S.from = box.querySelector("#htFrom").value; S.to = box.querySelector("#htTo").value; S.preset = ""; save("preset", ""); render(); };
    });
  }

  function table(head, rows, total) {
    var h = "<div class='ht-wrap'><table><thead><tr>" + head.map(function (x) { return "<th>" + x + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (total) h += "<tr class='total'>" + total.join("") + "</tr>";
    h += rows.length ? rows.join("") : "<tr><td colspan='" + head.length + "'>해당 기간 자료 없음</td></tr>";
    return h + "</tbody></table></div>";
  }
  function td(v, c) { return "<td" + (c ? " class='" + c + "'" : "") + ">" + v + "</td>"; }
  function tdl(v) { return "<td class='name' style='text-align:left'>" + esc(v) + "</td>"; }
  function sumBoxes(items) {
    return "<div class='ht-sum'>" + items.map(function (it) {
      return "<div><div class='k'>" + it[0] + "</div><div class='v " + (it[2] || "") + "'>" + it[1] + "</div></div>";
    }).join("") + "</div>";
  }

  // ── 1) 매매일지: 날짜(월)·종목별 매수/매도 합계 ──
  function viewJournal(a) {
    var g = {}, T = { bq: 0, ba: 0, sq: 0, sa: 0, fee: 0, tax: 0 };
    a.trades.forEach(function (t) {
      if (!inRange(t.date)) return;
      var k = keyOf(t.date) + "|" + t.code;
      var r = g[k] || (g[k] = { p: keyOf(t.date), code: t.code, bq: 0, ba: 0, sq: 0, sa: 0, fee: 0, tax: 0 });
      if (t.side === "매수") { r.bq += t.qty; r.ba += t.amt; T.bq += t.qty; T.ba += t.amt; }
      else { r.sq += t.qty; r.sa += t.amt; T.sq += t.qty; T.sa += t.amt; }
      r.fee += t.fee; r.tax += t.tax; T.fee += t.fee; T.tax += t.tax;
    });
    var rows = Object.keys(g).map(function (k) { return g[k]; }).sort(function (x, y) {
      return x.p < y.p ? 1 : x.p > y.p ? -1 : nameOf(x.code).localeCompare(nameOf(y.code), "ko");
    }).map(function (r) {
      return "<tr>" + td(r.p) + tdl(nameOf(r.code)) +
        td(r.bq ? won(r.bq) : "-") + td(r.bq ? won(r.ba / r.bq) : "-") + td(r.bq ? won(r.ba) : "-") +
        td(r.sq ? won(r.sq) : "-") + td(r.sq ? won(r.sa / r.sq) : "-") + td(r.sq ? won(r.sa) : "-") +
        td(won(r.fee)) + td(won(r.tax)) + "</tr>";
    });
    return sumBoxes([["매수금액", won(T.ba)], ["매도금액", won(T.sa)], ["수수료", won(T.fee)], ["제세금", won(T.tax)]]) +
      table([S.unit === "month" ? "월" : "매매일", "종목명", "매수수량", "매수평균가", "매수금액", "매도수량", "매도평균가", "매도금액", "수수료", "제세금"], rows,
        [td("합계"), td(""), td(won(T.bq)), td(""), td(won(T.ba)), td(won(T.sq)), td(""), td(won(T.sa)), td(won(T.fee)), td(won(T.tax))]);
  }

  // ── 2) 매도실현손익: 날짜(월)·종목별 ──
  function viewRealized(a) {
    var g = {}, T = { pnl: 0, cost: 0, sa: 0, unk: 0 };
    a.sells.forEach(function (s) {
      if (!inRange(s.date)) return;
      var k = keyOf(s.date) + "|" + s.code;
      var r = g[k] || (g[k] = { p: keyOf(s.date), code: s.code, q: 0, sa: 0, fee: 0, tax: 0, ba: 0, bf: 0, pnl: 0, kq: 0, unk: 0 });
      r.q += s.qty; r.sa += s.amt; r.fee += s.fee; r.tax += s.tax;
      if (s.pnl === null || s.pnl === undefined) { r.unk += 1; T.unk += 1; return; }
      r.kq += s.qty; r.ba += s.buy_amt; r.bf += s.buy_fee; r.pnl += s.pnl;
      T.pnl += s.pnl; T.cost += s.buy_amt + s.buy_fee; T.sa += s.amt;
    });
    var rows = Object.keys(g).map(function (k) { return g[k]; }).sort(function (x, y) {
      return x.p < y.p ? 1 : x.p > y.p ? -1 : nameOf(x.code).localeCompare(nameOf(y.code), "ko");
    }).map(function (r) {
      var known = r.kq > 0, cost = r.ba + r.bf, rate = known && cost ? r.pnl / cost * 100 : null;
      var pnlTxt = known ? won(r.pnl) + (r.unk ? " *" : "") : "확인불가";
      return "<tr>" + td(r.p) + tdl(nameOf(r.code)) + td(pnlTxt, known ? cls(r.pnl) : "") + td(pct(rate), cls(rate)) +
        td(won(r.q)) + td(won(r.sa / r.q)) + td(won(r.sa)) + td(won(r.fee)) + td(won(r.tax)) +
        td(known ? won(r.ba / r.kq) : "-") + td(known ? won(r.ba) : "-") + td(known ? won(r.bf) : "-") + "</tr>";
    });
    var rate = T.cost ? T.pnl / T.cost * 100 : null;
    return sumBoxes([["추정실현손익", won(T.pnl), cls(T.pnl)], ["수익률", pct(rate), cls(rate)], ["매도금액", won(T.sa)], ["확인불가", T.unk + "건"]]) +
      table([S.unit === "month" ? "월" : "매매일", "종목명", "추정실현손익", "수익률", "매도수량", "매도단가", "매도금액", "수수료", "제세금", "매입단가", "매수금액", "매수수수료"], rows) +
      "<div class='ht-note'>※ 추정실현손익 = 매도금액 − 매도수수료·제세금 − 매입단가×수량 − 매수수수료(보유수량 비례). 매입단가는 이동평균법으로 복원한 값입니다.<br>" +
      "※ 확인불가: 1년 전에 매수했거나 공모주 배정·입고처럼 매매일지에 매수 기록이 없는 경우. * 표시는 일부 체결만 계산된 경우입니다.</div>";
  }

  // ── 3) 일자별 실현손익 ──
  function viewDaily(a) {
    var g = {};
    a.sells.forEach(function (s) {
      if (!inRange(s.date)) return;
      var k = keyOf(s.date);
      var r = g[k] || (g[k] = { p: k, n: 0, sa: 0, pnl: 0, cost: 0, unk: 0, win: 0, loss: 0 });
      r.n += 1; r.sa += s.amt;
      if (s.pnl === null || s.pnl === undefined) { r.unk += 1; return; }
      r.pnl += s.pnl; r.cost += s.buy_amt + s.buy_fee;
      if (s.pnl > 0) r.win += 1; else if (s.pnl < 0) r.loss += 1;
    });
    var list = Object.keys(g).sort().map(function (k) { return g[k]; });
    var tot = list.reduce(function (t, r) { t.pnl += r.pnl; t.cost += r.cost; t.sa += r.sa; t.win += r.win; t.loss += r.loss; return t; }, { pnl: 0, cost: 0, sa: 0, win: 0, loss: 0 });
    var rows = list.slice().reverse().map(function (r) {
      var rate = r.cost ? r.pnl / r.cost * 100 : null;
      return "<tr>" + td(r.p) + td(won(r.pnl), cls(r.pnl)) + td(pct(rate), cls(rate)) + td(won(r.sa)) + td(r.n) + td(r.win + " / " + r.loss) + td(r.unk || "-") + "</tr>";
    });
    var trate = tot.cost ? tot.pnl / tot.cost * 100 : null;
    var winRate = tot.win + tot.loss ? tot.win / (tot.win + tot.loss) * 100 : null;
    return sumBoxes([["실현손익 합계", won(tot.pnl), cls(tot.pnl)], ["수익률", pct(trate), cls(trate)], ["매도금액", won(tot.sa)], ["승률(이익/손실 건)", winRate === null ? "-" : winRate.toFixed(1) + "%"]]) +
      barChart(list.map(function (r) { return [r.p, r.pnl]; })) +
      table([S.unit === "month" ? "월" : "매매일", "실현손익", "수익률", "매도금액", "매도건수", "이익/손실", "확인불가"], rows);
  }

  // ── 4) 예탁자산 증감 ──
  // 수익률은 증권사 방식(투자손익 ÷ 투자원금 평균잔고)으로 계산 — 잔고가 거의 0인 날의 극단값(-100% 등) 영향 제거
  function assetRows(a) {
    var g = {}, order = [];
    a.daily.forEach(function (d) {
      if (!inRange(d.date)) return;
      var k = keyOf(d.date);
      var r = g[k];
      if (!r) { r = g[k] = { p: k, begin: d.begin, end: d.end, inflow: 0, outflow: 0, pnl: 0, baseSum: 0, n: 0, active: false, days: [] }; order.push(k); }
      r.end = d.end; r.inflow += d.inflow; r.outflow += d.outflow; r.pnl += d.pnl;
      r.baseSum += d.base; r.n += 1; r.days.push(d);
      if (d.trade_amt || d.pnl || d.inflow || d.outflow || d.begin !== d.end) r.active = true;
    });
    return order.sort().map(function (k) {
      var r = g[k];
      r.avgBase = r.n ? r.baseSum / r.n : 0;
      r.rate = S.unit === "day" ? r.days[0].rate : (r.avgBase > 0 ? r.pnl / r.avgBase * 100 : null);
      return r;
    }).filter(function (r) { return S.unit === "month" || r.active; });   // 일별은 휴장일(변동 없음) 제외
  }
  function viewAsset(a) {
    var list = assetRows(a);
    var rows = list.slice().reverse().map(function (r) {
      var diff = r.end - r.begin;
      return "<tr>" + td(r.p) + td(won(r.begin)) + td(won(r.end)) + td(won(diff), cls(diff)) + td(won(r.inflow)) + td(won(r.outflow)) + td(won(r.pnl), cls(r.pnl)) + td(pct(r.rate, 2), cls(r.rate)) + "</tr>";
    });
    var first = list[0], last = list[list.length - 1];
    var inSum = list.reduce(function (s, r) { return s + r.inflow; }, 0), outSum = list.reduce(function (s, r) { return s + r.outflow; }, 0);
    var pnlSum = list.reduce(function (s, r) { return s + r.pnl; }, 0);
    return sumBoxes([["기초 예탁자산", first ? won(first.begin) : "-"], ["기말 예탁자산", last ? won(last.end) : "-"],
      ["입금 − 출금", won(inSum - outSum), cls(inSum - outSum)], ["투자손익", won(pnlSum), cls(pnlSum)]]) +
      lineChart(list.map(function (r) { return [r.p, r.end]; }), false) +
      table([S.unit === "month" ? "월" : "일자", "기초평가금액", "기말평가금액", "증감", "입금·입고", "출금·출고", "투자손익", "수익률"], rows) +
      "<div class='ht-note'>※ 증권사 '기간별수익률 상세'의 일별 값입니다. 투자손익 = 기말 − 기초 − 입금 + 출금 (실현+평가손익 포함).</div>";
  }

  // ── 5) 수익률 추이 ──
  function viewReturn(a) {
    // 누적 수익률 = 누적 투자손익 ÷ 지금까지 투자원금 평균잔고 (증권사 기간수익률과 같은 방식)
    var all = a.daily.filter(function (d) { return inRange(d.date); }).sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    var cumPnl = 0, baseSum = 0, n = 0, byKey = {};
    all.forEach(function (d) {
      cumPnl += d.pnl; baseSum += d.base; n += 1;
      byKey[keyOf(d.date)] = { cum: baseSum > 0 ? cumPnl / (baseSum / n) * 100 : null, cumPnl: cumPnl };
    });
    var list = assetRows(a);
    list.forEach(function (r) { var c = byKey[r.p] || {}; r.cum = c.cum; r.cumPnl = c.cumPnl; });
    var avgAll = n ? baseSum / n : 0;
    var meaningful = list.filter(function (r) { return r.rate !== null && r.avgBase >= avgAll * 0.05; });
    var rows = list.slice().reverse().map(function (r) {
      var small = r.avgBase < avgAll * 0.05;
      return "<tr>" + td(r.p) + td(pct(r.rate) + (small ? " ※" : ""), cls(r.rate)) + td(pct(r.cum), cls(r.cum)) + td(won(r.pnl), cls(r.pnl)) +
        td(won(r.cumPnl), cls(r.cumPnl)) + td(won(r.avgBase)) + td(won(r.end)) + "</tr>";
    });
    var last = list[list.length - 1];
    var best = meaningful.reduce(function (b, r) { return !b || r.rate > b.rate ? r : b; }, null);
    var worst = meaningful.reduce(function (b, r) { return !b || r.rate < b.rate ? r : b; }, null);
    var U = S.unit === "month" ? "월" : "일";
    return sumBoxes([["기간 수익률", last ? pct(last.cum) : "-", last ? cls(last.cum) : ""], ["기간 투자손익", last ? won(last.cumPnl) : "-", last ? cls(last.cumPnl) : ""],
      ["최고 " + U, best ? pct(best.rate) + " (" + best.p + ")" : "-", "up"], ["최저 " + U, worst ? pct(worst.rate) + " (" + worst.p + ")" : "-", "down"]]) +
      lineChart(list.filter(function (r) { return r.cum !== null; }).map(function (r) { return [r.p, r.cum]; }), true) +
      table([S.unit === "month" ? "월" : "일자", U + " 수익률", "누적 수익률", "투자손익", "누적 투자손익", "투자원금(평잔)", "기말평가금액"], rows) +
      "<div class='ht-note'>※ 수익률 = 투자손익 ÷ 투자원금 평균잔고 (증권사 '기간별수익률'과 같은 방식, 입출금 영향 제외).<br>" +
      "※ ※ 표시: 잔고가 매우 적던 기간이라 수익률이 크게 튀는 값입니다. 최고·최저 계산에서는 제외했습니다.</div>";
  }

  // ── 간단한 SVG 차트 ──
  function barChart(pts) {
    if (pts.length < 2) return "";
    var W = 600, H = 180, P = 6, max = Math.max.apply(null, pts.map(function (p) { return Math.abs(p[1]); })) || 1;
    var bw = (W - P * 2) / pts.length, mid = H / 2;
    var bars = pts.map(function (p, i) {
      var h = Math.abs(p[1]) / max * (mid - P), y = p[1] >= 0 ? mid - h : mid;
      return "<rect x='" + (P + i * bw + bw * 0.1).toFixed(1) + "' y='" + y.toFixed(1) + "' width='" + Math.max(bw * 0.8, 0.8).toFixed(1) + "' height='" + Math.max(h, 0.5).toFixed(1) +
        "' fill='" + (p[1] >= 0 ? "#d32f2f" : "#1565c0") + "'><title>" + p[0] + " " + won(p[1]) + "</title></rect>";
    }).join("");
    return "<div class='ht-chart'><svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none'><line x1='0' x2='" + W + "' y1='" + mid + "' y2='" + mid + "' stroke='#ccc'/>" + bars + "</svg></div>";
  }
  function lineChart(pts, isPct) {
    if (pts.length < 2) return "";
    var W = 600, H = 180, P = 8, ys = pts.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys);
    if (isPct) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    if (mx === mn) { mx += 1; mn -= 1; }
    function X(i) { return P + i * (W - P * 2) / (pts.length - 1); }
    function Y(v) { return H - P - (v - mn) / (mx - mn) * (H - P * 2); }
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
    var zero = isPct ? "<line x1='0' x2='" + W + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) + "' stroke='#ccc' stroke-dasharray='4 3'/>" : "";
    var lastV = ys[ys.length - 1], color = isPct ? (lastV >= 0 ? "#d32f2f" : "#1565c0") : "#3b4ab0";
    return "<div class='ht-chart'><svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none'>" + zero +
      "<path d='" + d + "' fill='none' stroke='" + color + "' stroke-width='2' vector-effect='non-scaling-stroke'/></svg>" +
      "<div style='display:flex;justify-content:space-between;font-size:11px;color:#999;padding:2px 4px'><span>" + pts[0][0] + "</span><span>" +
      (isPct ? pct(lastV) : won(lastV)) + "</span><span>" + pts[pts.length - 1][0] + "</span></div></div>";
  }

  // ── 그리기 ──
  function render() {
    var box = document.getElementById("tab-history");
    if (!DATA) return;
    var a = acc();
    var body;
    if (!a) body = "<div class='ht-msg'>" + esc(account()) + " 기록이 없습니다.</div>";
    else if (S.tab === "journal") body = viewJournal(a);
    else if (S.tab === "realized") body = viewRealized(a);
    else if (S.tab === "daily") body = viewDaily(a);
    else if (S.tab === "asset") body = viewAsset(a);
    else body = viewReturn(a);
    box.innerHTML = filterBar() + body +
      "<div class='ht-note'>기록 기준: " + esc(DATA.generated_at || "") + " (매일 저녁 갱신, 보관 기간 " + esc(DATA.start || "") + " ~ " + esc(DATA.end || "") + ")</div>";
    bindBar(box);
  }

  function init() {
    injectStyle();
    if (!buildShell()) return;
    S.unit = load("unit", "day");
    S.preset = load("preset", "1m");
    var r = presetRange(S.preset || "1m"); S.from = r[0]; S.to = r[1];
    var tab = load("tab", "holdings");
    setTab(TABS.some(function (t) { return t.id === tab; }) ? tab : "holdings");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
