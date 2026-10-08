/* history_tabs.js — 대시보드 기록 탭 (매매일지·매도실현손익·일자별실현손익·예탁자산증감·수익률추이·매매 성적)
   history.json(같은 폴더)을 읽어 계좌(전체 합산 포함)·일/월·기간 필터로 표시. history_collector.py가 함께 업로드합니다.
   종목명을 누르면 차트 팝업: 매매 일봉(charts.json) / 매매 5분봉(minutes.json, 실제 체결 시각) / 네이버 당일 흐름·일·주·월봉 이미지 */
(function () {
  "use strict";

  var TABS = [
    { id: "holdings", label: "보유현황" },
    { id: "scan", label: "추세 스캔" },
    { id: "trades", label: "매매내역" },
    { id: "daily", label: "일자별 실현손익" },
    { id: "assetret", label: "자산·수익률" },
    { id: "stats", label: "매매 성적" }
  ];
  var DATA = null, LOADING = false, LOAD_ERR = "";
  var S = { tab: "holdings", unit: "day", from: "", to: "", preset: "1m", acct: "" };

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
  var ALL = "전체(합산)";
  function accNames() { return DATA && DATA.accounts ? Object.keys(DATA.accounts).sort() : []; }
  // 기록 탭 계좌: 필터 막대에서 고른 값 (전체(합산) 포함). 위쪽 계좌 선택을 바꾸면 그 계좌로 따라감
  function account() {
    var names = accNames();
    if (S.acct === ALL || names.indexOf(S.acct) >= 0) return S.acct;
    var s = document.getElementById("accountSelect");
    return s && names.indexOf(s.value) >= 0 ? s.value : ALL;
  }
  // 한 계좌 자료 + (저녁 기록에 오늘 체결이 아직 없으면) 대시보드에 들어 있는 오늘 체결(TODAY_TRADES)을 붙임
  function oneAcc(name) {
    var a = DATA && DATA.accounts ? DATA.accounts[name] : null;
    var T = window.TODAY_TRADES, t = T && T.accounts ? T.accounts[name] : null;
    if (!t) return a;
    var base = a || { trades: [], sells: [], daily: [] };
    var out = { trades: base.trades, sells: base.sells, daily: base.daily || [], cycles: base.cycles };
    if ((t.trades || []).length && !base.trades.some(function (x) { return x.date === T.date; })) {
      out.trades = base.trades.concat(t.trades); out.sells = base.sells.concat(t.sells); out.today = true;
    }
    // 예탁자산: 저녁 확정값(증권사 기간수익률)이 아직 없으면 장중 추정자산으로 오늘 줄을 만듦
    var asset = t.asset, daily = out.daily;
    if (asset && asset.end && !daily.some(function (d) { return d.date === T.date; })) {
      var prev = null;
      for (var i = daily.length - 1; i >= 0; i--) if (daily[i].date < T.date) { prev = daily[i]; break; }
      if (prev) {
        var amt = (t.trades || []).reduce(function (s_, x) { return s_ + x.amt; }, 0), pnl = asset.end - prev.end;
        out.daily = daily.concat([{ date: T.date, begin: prev.end, end: asset.end, inflow: 0, outflow: 0, trade_amt: amt,
          pnl: pnl, base: prev.end, rate: prev.end > 0 ? pnl / prev.end * 100 : 0, live: asset.time || true }]);
      }
    }
    return out;
  }
  // 전체(합산): 매매·매도·사이클은 이어 붙이고, 일별 자산은 날짜별로 더한 뒤 수익률 다시 계산
  function mergeAcc(list) {
    var out = { trades: [], sells: [], cycles: [], daily: [] }, byDate = {};
    list.forEach(function (a) {
      out.trades = out.trades.concat(a.trades || []);
      out.sells = out.sells.concat(a.sells || []);
      out.cycles = out.cycles.concat(a.cycles || []);
      if (a.today) out.today = true;
      (a.daily || []).forEach(function (d) {
        var r = byDate[d.date] || (byDate[d.date] = { date: d.date, begin: 0, end: 0, inflow: 0, outflow: 0, trade_amt: 0, pnl: 0, base: 0 });
        ["begin", "end", "inflow", "outflow", "trade_amt", "pnl", "base"].forEach(function (f) { r[f] += d[f] || 0; });
        if (d.live) r.live = d.live;
      });
    });
    out.daily = Object.keys(byDate).sort().map(function (k) {
      var r = byDate[k]; r.rate = r.base > 0 ? r.pnl / r.base * 100 : 0; return r;
    });
    return out;
  }
  function acc() {
    var T = window.TODAY_TRADES;
    if (T && T.names && DATA) { DATA.names = DATA.names || {}; for (var c in T.names) if (!DATA.names[c]) DATA.names[c] = T.names[c]; }
    var name = account();
    if (name !== ALL) return oneAcc(name);
    var names = accNames();
    if (T && T.accounts) for (var k in T.accounts) if (names.indexOf(k) < 0) names.push(k);
    var list = names.map(oneAcc).filter(function (a) { return a; });
    return list.length ? mergeAcc(list) : null;
  }
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
      ".ht-opt{margin:0 0 8px;font-size:13px;color:#444;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ht-opt input{vertical-align:-2px}",
      ".ht-sort{cursor:pointer;user-select:none;white-space:nowrap}.ht-sort:hover{color:#3b4ab0}.ht-sort.on{color:#3b4ab0}.ht-sort .off{color:#ccc;font-size:10px}",
      ".ht-note{font-size:12px;color:#999;margin-top:8px;line-height:1.6}",
      ".ht-msg{padding:24px;text-align:center;color:#888;background:#fff;border-radius:8px}",
      ".ht-chart{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:8px 8px 4px;margin-bottom:12px}",
      ".ht-chart svg{width:100%;height:180px;display:block}",
      "@media (max-width:760px){.ht-wrap th,.ht-wrap td{padding:7px 9px;font-size:12px}.ht-sum{grid-template-columns:repeat(2,1fr)}}"
    ].join("\n");
    css += "\n" + chartStyle();
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
    if (sel) sel.addEventListener("change", function () { S.acct = sel.value; save("acct", S.acct); if (S.tab !== "holdings") render(); });
    return true;
  }

  function setTab(id) {
    S.tab = id; save("tab", id);
    document.querySelectorAll(".ht-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === id); });
    document.getElementById("tab-holdings").style.display = id === "holdings" ? "" : "none";
    document.getElementById("tab-history").style.display = id === "holdings" ? "none" : "";
    if (id === "scan") renderScan();
    else if (id !== "holdings") { if (!DATA) fetchData(); else render(); }
  }

  function fetchData() {
    if (LOADING) return;
    LOADING = true;
    var box = document.getElementById("tab-history");
    box.innerHTML = "<div class='ht-msg'>기록을 불러오는 중…</div>";
    function done(j) { DATA = j; LOADING = false; render(); }
    function fail(msg) {
      LOADING = false; LOAD_ERR = msg;
      box.innerHTML = "<div class='ht-msg'>기록 파일을 불러오지 못했습니다.<br>" + esc(msg) +
        "<br><small>history_data.js / history.json 이 대시보드와 같은 폴더에 있는지 확인해 주세요.</small></div>";
    }
    // 대체 방법: <script>로 history_data.js 읽기 (PC 파일로 직접 열어도 동작)
    function viaScript(prevErr) {
      var sc = document.createElement("script");
      sc.src = "history_data.js?t=" + Date.now();
      sc.onload = function () { if (window.HISTORY_DATA) done(window.HISTORY_DATA); else fail("history_data.js 내용 없음"); };
      sc.onerror = function () { fail((prevErr ? prevErr + " / " : "") + "history_data.js 읽기 실패"); };
      document.head.appendChild(sc);
    }
    if (location.protocol === "file:" || !window.fetch) { viaScript(""); return; }
    fetch("history.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(done).catch(function (e) { viaScript(String(e)); });
  }

  // ── 필터 막대 ──
  function filterBar() {
    function seg(name, items, cur) {
      return "<span class='ht-seg'>" + items.map(function (it) {
        return "<button data-" + name + "='" + it[0] + "' class='" + (it[0] === cur ? "on" : "") + "'>" + it[1] + "</button>";
      }).join("") + "</span>";
    }
    var cur = account();
    var opts = accNames().concat([ALL]).map(function (n) {
      return "<option" + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>";
    }).join("");
    return "<div class='ht-bar'>" +
      "<span>계좌</span><select id='htAcct'>" + opts + "</select>" +
      seg("unit", [["day", "일"], ["month", "월"]], S.unit) +
      "<span>매매일</span><input type='date' id='htFrom' value='" + S.from + "'> ~ <input type='date' id='htTo' value='" + S.to + "'>" +
      seg("preset", [["today", "오늘"], ["1w", "1주"], ["1m", "1개월"], ["3m", "3개월"], ["6m", "6개월"], ["1y", "1년"]], S.preset) +
      "</div>";
  }

  function bindBar(box) {
    var dt = box.querySelector("#htDetail");
    if (dt) dt.onchange = function () { save("detail", dt.checked ? "1" : "0"); render(); };
    box.querySelectorAll("[data-archart]").forEach(function (b) {
      b.onclick = function () { save("arChart", b.getAttribute("data-archart")); render(); };
    });
    box.querySelectorAll("[data-sort]").forEach(function (el) {
      el.onclick = function () {
        var v = el.getAttribute("data-sort"), i = v.indexOf(":"), tab = v.slice(0, i), key = v.slice(i + 1), st = sortState(tab);
        // 처음 누르면 ▼(큰 값·최근 먼저), 다시 누르면 ▲, 종목명은 ▲(가나다)부터
        var dir = st.k === key ? (st.dir === "asc" ? "desc" : "asc") : (key === "name" ? "asc" : "desc");
        save("sort_" + tab, key + ":" + dir); render();
      };
    });
    var as = box.querySelector("#htAcct");
    if (as) as.onchange = function () {
      S.acct = as.value; save("acct", S.acct);
      if (window.switchAccount) window.switchAccount(S.acct);      // 보유현황 탭도 같은 계좌로
      render();
    };
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
      if (!el) return;
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
  // ── 표 정렬: 제목을 누르면 ▲(오름차순) / ▼(내림차순) 전환, 탭별로 기억 ──
  function sortState(tab) {
    var v = load("sort_" + tab, ""), i = v.indexOf(":");
    return i > 0 ? { k: v.slice(0, i), dir: v.slice(i + 1) } : { k: "", dir: "" };
  }
  function sh(tab, label, key) {
    var st = sortState(tab), on = st.k === key;
    return "<span class='ht-sort" + (on ? " on" : "") + "' data-sort='" + tab + ":" + key + "'>" + label + " " +
      (on ? (st.dir === "asc" ? "▲" : "▼") : "<span class='off'>▲▼</span>") + "</span>";
  }
  function sortRecs(tab, list, getters) {
    var st = sortState(tab), g = getters[st.k];
    if (!g) return list;
    var m = st.dir === "asc" ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var x = g(a), y = g(b);
      if (x === null || x === undefined || (typeof x === "number" && isNaN(x))) return 1;      // 값 없는 줄은 항상 아래
      if (y === null || y === undefined || (typeof y === "number" && isNaN(y))) return -1;
      if (typeof x === "string") return x.localeCompare(y, "ko") * m;
      return (x - y) * m;
    });
  }
  function tdl(v) { return "<td class='name' style='text-align:left'>" + esc(v) + "</td>"; }
  function tdc(code) { return "<td class='name' style='text-align:left' data-code='" + esc(code) + "'>" + esc(nameOf(code)) + "</td>"; }
  function sumBoxes(items) {
    return "<div class='ht-sum'>" + items.map(function (it) {
      return "<div><div class='k'>" + it[0] + "</div><div class='v " + (it[2] || "") + "'>" + it[1] + "</div></div>";
    }).join("") + "</div>";
  }

  // ── 1) 매매내역: 날짜(월)·종목별 매수·매도 + 실현손익 (예전 매매일지 + 매도실현손익) ──
  function viewTrades(a) {
    var g = {}, T = { bq: 0, ba: 0, sq: 0, sa: 0, fee: 0, pnl: 0, cost: 0, bf: 0, unk: 0 };
    function rec(date, code) {
      var k = keyOf(date) + "|" + code;
      return g[k] || (g[k] = { p: keyOf(date), code: code, bq: 0, ba: 0, sq: 0, sa: 0, fee: 0, kq: 0, cost: 0, bf: 0, pnl: 0, unk: 0, ns: 0 });
    }
    a.trades.forEach(function (t) {
      if (!inRange(t.date)) return;
      var r = rec(t.date, t.code);
      if (t.side === "매수") { r.bq += t.qty; r.ba += t.amt; T.bq += t.qty; T.ba += t.amt; }
      else { r.sq += t.qty; r.sa += t.amt; T.sq += t.qty; T.sa += t.amt; }
      r.fee += t.fee + t.tax; T.fee += t.fee + t.tax;
    });
    a.sells.forEach(function (s) {
      if (!inRange(s.date)) return;
      var r = rec(s.date, s.code); r.ns += 1;
      if (s.pnl === null || s.pnl === undefined) { r.unk += 1; T.unk += 1; return; }
      r.kq += s.qty; r.cost += s.buy_amt; r.bf += s.buy_fee; r.pnl += s.pnl;
      T.pnl += s.pnl; T.cost += s.buy_amt; T.bf += s.buy_fee;
    });
    var recs = Object.keys(g).map(function (k) { return g[k]; }).sort(function (x, y) {
      return x.p < y.p ? 1 : x.p > y.p ? -1 : nameOf(x.code).localeCompare(nameOf(y.code), "ko");
    });
    function rateOf(r) { return r.kq > 0 && r.cost ? r.pnl / r.cost * 100 : null; }
    recs = sortRecs("trades", recs, {
      date: function (r) { return r.p; }, name: function (r) { return nameOf(r.code); },
      bavg: function (r) { return r.bq ? r.ba / r.bq : null; }, bamt: function (r) { return r.bq ? r.ba : null; },
      savg: function (r) { return r.sq ? r.sa / r.sq : null; }, samt: function (r) { return r.sq ? r.sa : null; },
      pnl: function (r) { return r.kq > 0 ? r.pnl : null; }, rate: rateOf
    });
    var detail = load("detail", "0") === "1";
    var rows = recs.map(function (r) {
      var known = r.kq > 0, rate = rateOf(r);
      var pnlTxt = !r.ns ? "-" : known ? won(r.pnl) + (r.unk ? " *" : "") : "확인불가";
      return "<tr>" + td(r.p) + tdc(r.code) +
        td(r.bq ? won(r.bq) : "-") + td(r.bq ? won(r.ba / r.bq) : "-") + td(r.bq ? won(r.ba) : "-") +
        td(r.sq ? won(r.sq) : "-") + td(r.sq ? won(r.sa / r.sq) : "-") + td(r.sq ? won(r.sa) : "-") +
        td(pnlTxt, known ? cls(r.pnl) : "") + td(known ? pct(rate) : "-", cls(rate)) + td(won(r.fee)) +
        (detail ? td(known ? won(r.cost / r.kq) : "-") + td(known ? won(r.cost) : "-") + td(known ? won(r.bf) : "-") : "") + "</tr>";
    });
    var trate = T.cost ? T.pnl / T.cost * 100 : null;
    var head = [sh("trades", S.unit === "month" ? "월" : "매매일", "date"), sh("trades", "종목명", "name"),
      "매수수량", sh("trades", "매수평균가", "bavg"), sh("trades", "매수금액", "bamt"),
      "매도수량", sh("trades", "매도단가", "savg"), sh("trades", "매도금액", "samt"),
      sh("trades", "실현손익", "pnl"), sh("trades", "수익률", "rate"), "수수료·세금"].concat(detail ? ["매입단가", "매입원가", "매수수수료"] : []);
    var total = [td("합계"), td(""), td(won(T.bq)), td(""), td(won(T.ba)), td(won(T.sq)), td(""), td(won(T.sa)),
      td(won(T.pnl), cls(T.pnl)), td(pct(trate), cls(trate)), td(won(T.fee))].concat(detail ? [td(""), td(won(T.cost)), td(won(T.bf))] : []);
    return sumBoxes([["매수금액", won(T.ba)], ["매도금액", won(T.sa)], ["실현손익", won(T.pnl), cls(T.pnl)], ["수익률", pct(trate), cls(trate)],
        ["수수료·세금", won(T.fee)], ["확인불가", T.unk + "건"]]) +
      "<div class='ht-opt'><label><input type='checkbox' id='htDetail'" + (detail ? " checked" : "") + "> 상세 보기 (HTS [6303] 대조용: 매입단가·매입원가·매수수수료)</label></div>" +
      table(head, rows, total) +
      "<div class='ht-note'>※ 실현손익은 HTS [6303]과 같은 계산: 매도금액 − 매도수수료·제세금 − 매입원가 − 매수수수료(매입원가×0.015%), 수익률 = 실현손익 ÷ 매입원가.<br>" +
      "※ 매입원가 = 판 주식을 원래 산 금액 (그날 새로 산 '매수금액'과 다른 숫자). 매입단가는 체결 시각 순서대로 이동평균법으로 다시 계산한 값입니다.<br>" +
      "※ 확인불가: 1년 전에 매수했거나 공모주 배정·입고처럼 매수 기록이 없는 경우. * 표시는 일부 체결만 계산된 경우입니다.</div>";
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
      r.pnl += s.pnl; r.cost += s.buy_amt;
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
      if (d.live) r.live = d.live;
      if (d.trade_amt || d.pnl || d.inflow || d.outflow || d.begin !== d.end || d.live) r.active = true;
    });
    return order.sort().map(function (k) {
      var r = g[k];
      r.avgBase = r.n ? r.baseSum / r.n : 0;
      r.rate = S.unit === "day" ? r.days[0].rate : (r.avgBase > 0 ? r.pnl / r.avgBase * 100 : null);
      return r;
    }).filter(function (r) { return S.unit === "month" || r.active; });   // 일별은 휴장일(변동 없음) 제외
  }
  // ── 오늘(하루) 선택: 전 거래일과 비교 ──
  function compareView(a) {
    var daily = a.daily.filter(function (d) { return d.date <= S.to; }).sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    var act = daily.filter(function (d) { return d.trade_amt || d.pnl || d.inflow || d.outflow || d.begin !== d.end || d.live; });
    var cur = act[act.length - 1];
    if (!cur) return "<div class='ht-msg'>해당 날짜의 예탁자산 자료가 없습니다.</div>";
    var prev = null;
    for (var i = daily.length - 1; i >= 0; i--) if (daily[i].date < cur.date) { prev = daily[i]; break; }
    var diff = prev ? cur.end - prev.end : null;
    var real = a.sells.filter(function (x) { return x.date === cur.date && x.pnl !== null && x.pnl !== undefined; })
      .reduce(function (t, x) { return t + x.pnl; }, 0);
    var live = cur.live, curLbl = live ? "오늘 현재 (" + (live === true ? "장중" : live) + " 추정)" : cur.date + " 기말";
    function row(lbl, d) {
      var df = d.end - d.begin;
      return "<tr>" + tdl(lbl) + td(d.date) + td(won(d.begin)) + td(won(d.end)) + td(won(df), cls(df)) + td(won(d.inflow)) + td(won(d.outflow)) +
        td(won(d.pnl), cls(d.pnl)) + td(pct(d.rate), cls(d.rate)) + "</tr>";
    }
    return sumBoxes([[(prev ? prev.date : "전 거래일") + " 기말", prev ? won(prev.end) : "-"], [curLbl, won(cur.end)],
        ["전 거래일 대비 증감", diff === null ? "-" : won(diff), cls(diff)], ["투자손익 (입출금 제외)", won(cur.pnl), cls(cur.pnl)],
        ["수익률", pct(cur.rate), cls(cur.rate)], ["당일 실현손익", won(real), cls(real)]]) +
      table(["구분", "일자", "기초평가금액", "기말평가금액", "증감", "입금·입고", "출금·출고", "투자손익", "수익률"],
        (prev ? [row("전 거래일", prev)] : []).concat([row(live ? "오늘 (장중 추정)" : "선택일", cur)]).reverse()) +
      "<div class='ht-note'>" + (cur.date !== S.to ? "※ " + esc(S.to) + " 자료가 없어 가장 최근 거래일(" + esc(cur.date) + ")을 보여드립니다.<br>" : "") +
      (live ? "※ 오늘 값은 대시보드의 장중 추정자산(1분마다 갱신)으로 계산한 추정치입니다. 오늘 입출금은 반영되지 않으며, 저녁 기록 갱신 후 증권사 확정값으로 바뀝니다.<br>" : "") +
      "※ 수익률 = 투자손익 ÷ 전 거래일 기말평가금액.</div>";
  }
  // ── 4) 자산·수익률 (예전 예탁자산 증감 + 수익률 추이) ──
  //   수익률은 증권사 방식(투자손익 ÷ 투자원금 평균잔고) — 잔고가 거의 0인 날의 극단값 영향 제거
  function viewAssetReturn(a) {
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
      return "<tr>" + td(r.p + (r.live ? " <small style='color:#e65100'>장중 추정</small>" : "")) + td(won(r.begin)) + td(won(r.end)) +
        td(won(r.inflow)) + td(won(r.outflow)) + td(won(r.pnl), cls(r.pnl)) + td(pct(r.rate) + (small ? " ※" : ""), cls(r.rate)) +
        td(pct(r.cum), cls(r.cum)) + td(won(r.cumPnl), cls(r.cumPnl)) + "</tr>";
    });
    var first = list[0], last = list[list.length - 1];
    var inSum = list.reduce(function (s, r) { return s + r.inflow; }, 0), outSum = list.reduce(function (s, r) { return s + r.outflow; }, 0);
    var best = meaningful.reduce(function (b, r) { return !b || r.rate > b.rate ? r : b; }, null);
    var worst = meaningful.reduce(function (b, r) { return !b || r.rate < b.rate ? r : b; }, null);
    var U = S.unit === "month" ? "월" : "일", ch = load("arChart", "asset");
    var chart = ch === "rate" ? lineChart(list.filter(function (r) { return r.cum !== null; }).map(function (r) { return [r.p, r.cum]; }), true)
      : lineChart(list.map(function (r) { return [r.p, r.end]; }), false);
    return sumBoxes([["기초 예탁자산", first ? won(first.begin) : "-"], ["기말 예탁자산", last ? won(last.end) : "-"],
        ["입금 − 출금", won(inSum - outSum), cls(inSum - outSum)], ["기간 투자손익", last ? won(last.cumPnl) : "-", last ? cls(last.cumPnl) : ""],
        ["기간 수익률", last ? pct(last.cum) : "-", last ? cls(last.cum) : ""],
        ["최고 / 최저 " + U, (best ? pct(best.rate) : "-") + " / " + (worst ? pct(worst.rate) : "-")]]) +
      "<div class='ht-opt'><span class='ht-seg'><button data-archart='asset' class='" + (ch !== "rate" ? "on" : "") + "'>예탁자산</button>" +
      "<button data-archart='rate' class='" + (ch === "rate" ? "on" : "") + "'>누적 수익률</button></span>" +
      (best ? " <small style='color:#888'>최고 " + best.p + " · 최저 " + (worst ? worst.p : "-") + "</small>" : "") + "</div>" +
      chart +
      table([S.unit === "month" ? "월" : "일자", "기초평가금액", "기말평가금액", "입금·입고", "출금·출고", "투자손익", U + " 수익률", "누적 수익률", "누적 투자손익"], rows) +
      "<div class='ht-note'>※ 증권사 '기간별수익률 상세'의 일별 값입니다. 투자손익 = 기말 − 기초 − 입금 + 출금 (실현+평가손익 포함).<br>" +
      "※ 수익률 = 투자손익 ÷ 투자원금 평균잔고 (증권사 '기간별수익률'과 같은 방식, 입출금 영향 제외). [오늘]을 누르면 전 거래일과 비교합니다.<br>" +
      "※ ※ 표시: 잔고가 매우 적던 기간이라 수익률이 크게 튀는 값입니다. 최고·최저 계산에서는 제외했습니다.</div>";
  }

  // ── 6) 매매 성적: 거래 사이클(사서 전량 팔 때까지) 기준 승률·손익비·켈리 ──
  var ETF_WORDS = ["KODEX", "TIGER", "KBSTAR", "ACE ", "SOL ", "RISE ", "PLUS ", "HANARO", "ARIRANG", "KOSEF", "TIMEFOLIO"];
  function isEtf(code) { var n = nameOf(code); return ETF_WORDS.some(function (w) { return n.indexOf(w.trim()) === 0; }); }
  function statsOf(list) {
    var n = list.length, w = list.filter(function (c) { return c.pnl > 0; }), l = list.filter(function (c) { return c.pnl <= 0; });
    function avg(a) { return a.length ? a.reduce(function (s, c) { return s + c.rate; }, 0) / a.length : 0; }
    var W = n ? w.length / n : 0, aw = avg(w), al = Math.abs(avg(l)), R = al ? aw / al : null;
    var K = R ? W - (1 - W) / R : null;
    return { n: n, W: W, aw: aw, al: al, R: R, K: K, E: W * aw - (1 - W) * al,
      pnl: list.reduce(function (s, c) { return s + c.pnl; }, 0),
      days: n ? list.reduce(function (s, c) { return s + c.days; }, 0) / n : 0 };
  }
  function statRow(label, st) {
    return "<tr>" + tdl(label) + td(st.n) + td(st.n ? (st.W * 100).toFixed(1) + "%" : "-") +
      td(st.n ? "+" + st.aw.toFixed(2) + "%" : "-", "up") + td(st.n ? "-" + st.al.toFixed(2) + "%" : "-", "down") +
      td(st.R === null ? "-" : st.R.toFixed(2)) + td(st.K === null ? "-" : pct(st.K * 100, 1), cls(st.K)) +
      td(st.n ? pct(st.E, 2) : "-", cls(st.E)) + td(won(st.pnl), cls(st.pnl)) + td(st.n ? st.days.toFixed(1) + "일" : "-") + "</tr>";
  }
  function viewStats(a) {
    var cs = (a.cycles || []).filter(function (c) { return inRange(c.end); });
    if (!cs.length) return "<div class='ht-msg'>해당 기간에 완료된 거래(사서 전량 판 거래)가 없습니다.<br><small>매매 성적은 매일 저녁 기록 갱신 때 계산됩니다.</small></div>";
    var all = statsOf(cs);
    var head = ["구분", "거래수", "승률", "평균 이익", "평균 손실", "손익비", "켈리", "기대값/거래", "실현손익", "평균 보유"];
    var buckets = [["당일 (0일)", 0, 0], ["1~5일", 1, 5], ["6~20일", 6, 20], ["21일 이상", 21, 99999]];
    var byHold = buckets.map(function (b) { return statRow(b[0], statsOf(cs.filter(function (c) { return c.days >= b[1] && c.days <= b[2]; }))); });
    var byType = [statRow("ETF", statsOf(cs.filter(function (c) { return isEtf(c.code); }))),
                  statRow("개별주식", statsOf(cs.filter(function (c) { return !isEtf(c.code); })))];
    var months = {};
    cs.forEach(function (c) { (months[c.end.slice(0, 7)] = months[c.end.slice(0, 7)] || []).push(c); });
    var byMonth = Object.keys(months).sort().reverse().map(function (m) { return statRow(m, statsOf(months[m])); });
    var be = all.W > 0 ? (1 - all.W) / all.W : null;
    return sumBoxes([["거래 수 (사이클)", all.n + "건"], ["승률", (all.W * 100).toFixed(1) + "%"],
      ["손익비", all.R === null ? "-" : all.R.toFixed(2)], ["켈리 비율", all.K === null ? "-" : pct(all.K * 100, 1), cls(all.K)],
      ["기대값/거래", pct(all.E, 2), cls(all.E)], ["실현손익", won(all.pnl), cls(all.pnl)]]) +
      "<h3>보유 기간별</h3>" + table(head, byHold) +
      "<h3>종목 유형별</h3>" + table(head, byType) +
      "<h3>월별 (매도 완료 월 기준)</h3>" + table(head, byMonth) +
      "<div class='ht-note'>※ 거래 1건 = 한 종목을 사기 시작해서 전량 팔 때까지(분할 매도는 1건으로 묶음). 수익률 = 실현손익 ÷ 매수금액.<br>" +
      "※ 켈리 = 승률 − (1 − 승률) ÷ 손익비. 마이너스면 같은 금액으로 계속하면 손해가 나는 구조입니다." +
      (be ? " 현재 승률에서 켈리가 0이 되려면 손익비 " + be.toFixed(2) + " 이상이 필요합니다." : "") +
      "<br>※ 아직 보유 중인 종목, 원가를 알 수 없는 거래(1년 이전 매수 등)는 제외. 오늘 거래는 저녁 기록 갱신 후 반영됩니다.</div>";
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

  // ── 종목 차트 팝업: 종목명(data-code)을 누르면 열림 ──
  //   일봉·주봉·월봉 = charts.json(LS 수정주가) + 내 매수▲/매도▼ + 10·20 이동평균 (확대·축소·기간 버튼)
  //   5분봉 = minutes.json(LS 5분봉) + 실제 체결 시각 ▲▼
  //   당일 흐름 = 네이버 이미지 (LS 자료가 없을 때도 네이버 이미지로 대신 표시)
  var LWC_URL = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
  var MINUTES = null, LOADQ = {}, LWC_LOADING = null;
  var CV = { code: "", name: "", view: "my", chart: null, n: 0 };
  var VIEWS = [["my", "일봉"], ["wk", "주봉"], ["mo", "월봉"], ["min", "5분봉"], ["area", "당일 흐름"], ["inv", "투자자"]];
  // 봉 종류별 설정: 자료 키, 이동평균 이름, 기간 버튼, 대신 보여줄 네이버 이미지
  var KIND = {
    my: { key: "d", unit: "일", ranges: [["1개월", 21], ["3개월", 63], ["6개월", 126], ["1년", 250], ["전체", 0]], naver: "day", name: "일봉" },
    wk: { key: "w", unit: "주", ranges: [["6개월", 26], ["1년", 52], ["2년", 104], ["3년", 156], ["전체", 0]], naver: "week", name: "주봉" },
    mo: { key: "m", unit: "개월", ranges: [["1년", 12], ["3년", 36], ["5년", 60], ["10년", 120], ["전체", 0]], naver: "month", name: "월봉" }
  };

  function loadScript(src, ok, bad) {
    var sc = document.createElement("script"); sc.src = src;
    sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc);
  }
  // json 파일을 읽고, 안 되면 같은 내용의 *_data.js를 <script>로 읽음 (PC에서 파일로 열 때)
  function loadData(json, js, globalName, cb) {
    var q = LOADQ[json];
    if (q === true) return cb(window["__" + globalName]);
    if (q) { q.push(cb); return; }
    LOADQ[json] = [cb];
    function done(j) { window["__" + globalName] = j || null; var l = LOADQ[json]; LOADQ[json] = true; l.forEach(function (f) { f(j || null); }); }
    function viaScript() { loadScript(js + "?t=" + Date.now(), function () { done(window[globalName]); }, function () { done(null); }); }
    if (location.protocol === "file:" || !window.fetch) return viaScript();
    fetch(json + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.json();
    }).then(done).catch(viaScript);
  }
  // 종목별 차트 파일 charts/종목코드.js (일봉 3년·주봉 10년·월봉 상장 이후) — 누른 종목만 받음
  var CHART_ONE = {}, CHART_WAIT = {};
  window.__chartLoaded = function (code, data) {
    CHART_ONE[code] = data;
    var l = CHART_WAIT[code] || []; delete CHART_WAIT[code];
    l.forEach(function (f) { f(data); });
  };
  function loadChartOne(code, cb) {
    if (CHART_ONE.hasOwnProperty(code)) return cb(CHART_ONE[code]);
    if (CHART_WAIT[code]) { CHART_WAIT[code].push(cb); return; }
    CHART_WAIT[code] = [cb];
    function miss() { if (CHART_WAIT[code]) window.__chartLoaded(code, null); }
    loadScript("charts/" + encodeURIComponent(code) + ".js?t=" + Math.floor(Date.now() / 600000), function () { setTimeout(miss, 0); }, miss);
  }
  function loadMinutes(cb) { loadData("minutes.json", "minutes_data.js", "MINUTE_DATA", function (j) { MINUTES = j; cb(j); }); }
  function loadHistory(cb) {
    if (DATA) return cb();
    loadData("history.json", "history_data.js", "HISTORY_DATA", function (j) { if (!DATA && j) DATA = j; cb(); });
  }
  function loadLwc(cb) {
    if (window.LightweightCharts) return cb(true);
    if (LWC_LOADING) { LWC_LOADING.push(cb); return; }
    LWC_LOADING = [cb];
    loadScript(LWC_URL, function () { var l = LWC_LOADING; LWC_LOADING = null; l.forEach(function (f) { f(true); }); },
      function () { var l = LWC_LOADING; LWC_LOADING = null; l.forEach(function (f) { f(false); }); });
  }

  function chartStyle() {
    return [
      "[data-code]{cursor:pointer;color:#3b4ab0;text-decoration:underline dotted;text-underline-offset:3px}",
      ".hc-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px}",
      ".hc-box{background:#fff;border-radius:12px;width:min(980px,100%);max-height:96vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.3);padding:14px 16px}",
      ".hc-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}",
      ".hc-title{font-size:18px;font-weight:bold}.hc-code{color:#888;font-size:13px}",
      ".hc-x{margin-left:auto;border:none;background:#eee;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer}",
      ".hc-views{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}",
      ".hc-views button{border:1px solid #3b4ab0;background:#fff;color:#3b4ab0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px}",
      ".hc-views button.on{background:#3b4ab0;color:#fff}",
      ".hc-range{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:2px 0 4px}",
      ".hc-range button{border:1px solid #ccc;background:#fafafa;color:#333;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:12px;min-width:34px}",
      ".hc-range button:hover{background:#e8eaf6}",
      ".hc-range .sp{flex:1}",
      ".hc-range input[type=date]{padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:12px}",
      ".hc-mk{margin-left:8px;font-size:13px;color:#333;cursor:pointer;white-space:nowrap;user-select:none}.hc-mk input{vertical-align:-2px;margin-right:3px}",
      ".hc-chart{width:100%;height:440px;position:relative}",
      ".hc-tip{position:absolute;z-index:5;display:none;pointer-events:none;background:rgba(255,255,255,.96);border:1px solid #c5cae9;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.18);padding:6px 9px;font-size:12px;line-height:1.5;min-width:150px}",
      ".hc-tip .t{font-weight:bold;margin-bottom:2px}.hc-tip table{border-collapse:collapse;width:100%;box-shadow:none;margin:0;background:none}",
      ".hc-tip td{padding:0 0 0 0;border:none;text-align:right;white-space:nowrap;font-size:12px;background:none}.hc-tip td:first-child{text-align:left;color:#777;padding-right:12px}",
      ".hc-tip .tr{margin-top:3px;padding-top:3px;border-top:1px dashed #ddd;white-space:nowrap}",
      ".hc-legend{font-size:12px;color:#555;margin:4px 0;min-height:18px}",
      ".hc-legend b{font-weight:normal;padding:0 6px 0 0;white-space:nowrap;display:inline-block}",
      ".hc-img{width:100%;max-width:700px;display:block;margin:0 auto}",
      ".hc-foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:12px;color:#999;margin-top:8px}",
      ".hc-foot a{color:#3b4ab0}",
      ".hc-trades{margin-top:10px}.hc-trades table{width:100%;font-size:13px}",
      "@media (max-width:760px){.hc-chart{height:320px}.hc-box{padding:10px}.hc-ov{padding:4px}.hc-views button{padding:5px 8px;font-size:12px}" +
      ".hc-range{gap:3px}.hc-range button{padding:4px 6px;min-width:0;font-size:11px}.hc-mk{margin-left:2px;font-size:12px}}"
    ].join("\n");
  }

  // 이 종목의 내 매매(현재 선택 계좌)를 날짜·구분별로 합침
  function myTrades(code) {
    var a = DATA ? acc() : null, g = {};
    ((a && a.trades) || []).forEach(function (t) {
      if (t.code !== code) return;
      var k = t.date + "|" + t.side;
      var r = g[k] || (g[k] = { date: t.date, side: t.side, qty: 0, amt: 0, pnl: null });
      r.qty += t.qty; r.amt += t.amt;
    });
    ((a && a.sells) || []).forEach(function (s) {
      if (s.code !== code || s.pnl === null || s.pnl === undefined) return;
      var r = g[s.date + "|매도"]; if (r) r.pnl = (r.pnl || 0) + s.pnl;
    });
    return Object.keys(g).sort().map(function (k) { return g[k]; });
  }
  // 이 종목의 실제 체결(시각 포함) — 현재 선택 계좌 (전체(합산)이면 모든 계좌)
  function myExecs(code) {
    var out = [], ex = (MINUTES && MINUTES.execs) || {}, name = account();
    Object.keys(ex).forEach(function (accName) {
      if (name !== ALL && accName !== name) return;
      Object.keys(ex[accName]).forEach(function (d) {
        (ex[accName][d][code] || []).forEach(function (e) {
          out.push({ date: d, time: String(e[0]).slice(0, 6), side: e[1], qty: e[2], price: e[3], acc: accName });
        });
      });
    });
    return out.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
  }
  function ma(closes, n) {
    var out = [], s = 0;
    for (var i = 0; i < closes.length; i++) {
      s += closes[i]; if (i >= n) s -= closes[i - n];
      out.push(i >= n - 1 ? s / n : null);
    }
    return out;
  }
  function dstr(n) { n = String(n); return n.slice(0, 4) + "-" + n.slice(4, 6) + "-" + n.slice(6, 8); }
  // 분봉 시각: 한국 시각을 그대로 표시하려고 UTC로 넣음
  function utc(d, hhmm) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +hhmm.slice(0, 2), +hhmm.slice(2, 4)) / 1000; }
  function hm(t) { var x = new Date(t * 1000); return ("0" + x.getUTCHours()).slice(-2) + ":" + ("0" + x.getUTCMinutes()).slice(-2); }
  function md(t) { var x = new Date(t * 1000); return ("0" + (x.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + x.getUTCDate()).slice(-2); }

  // 코스피·코스닥 약식 캔들을 누르면 크게 보기 (자료: 대시보드에 들어 있는 window.MKT_CANDLES)
  function openIndexChart(code, name, k) {
    var m = (window.MKT_CANDLES || {})[code];
    if (!m) return;
    function conv(bars) {
      var o = { d: [], o: [], h: [], l: [], c: [] };
      (bars || []).forEach(function (b) { o.d.push(+b[0]); o.o.push(b[1]); o.h.push(b[2]); o.l.push(b[3]); o.c.push(b[4]); });
      return o;
    }
    CHART_ONE["IDX" + code] = { f: iso(new Date()), d: conv(m.d), w: conv(m.w), m: conv(m.m) };
    save("chartView", { d: "my", w: "wk", m: "mo" }[k] || "my");
    openChart("IDX" + code, name || m.name);
  }
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-mkt]") : null;
    if (el) openIndexChart(el.getAttribute("data-mkt"), el.getAttribute("data-mname"), el.getAttribute("data-mk"));
  });

  function openChart(code, name) {
    CV.code = code; CV.name = name || nameOf(code);
    var isIdx = String(code).indexOf("IDX") === 0;
    var views = isIdx ? VIEWS.slice(0, 3) : VIEWS;          // 지수는 일·주·월봉만
    var link = isIdx ? "https://finance.naver.com/sise/sise_index.naver?code=" + (code === "IDX301" ? "KOSDAQ" : "KOSPI")
      : "https://finance.naver.com/item/main.naver?code=" + encodeURIComponent(code);
    var ov = document.getElementById("hcOv");
    if (!ov) {
      ov = document.createElement("div"); ov.id = "hcOv"; ov.className = "hc-ov";
      ov.onclick = function (e) { if (e.target === ov) closeChart(); };
      document.body.appendChild(ov);
    }
    ov.style.display = "flex";
    ov.innerHTML = "<div class='hc-box'><div class='hc-head'><span class='hc-title'>" + esc(CV.name) + "</span><span class='hc-code'>" + esc(isIdx ? "지수" : code) +
      "</span><button class='hc-x' title='닫기'>×</button></div><div class='hc-views'>" + views.map(function (v) {
        return "<button data-hcv='" + v[0] + "'>" + v[1] + "</button>";
      }).join("") + "</div><div id='hcBody'></div>" +
      "<div class='hc-foot'><a href='" + link + "' target='_blank' rel='noopener'>네이버 증권에서 보기 ↗</a>" +
      "<span>차트: <a href='https://www.tradingview.com/' target='_blank' rel='noopener'>TradingView Lightweight Charts</a> · 당일 흐름·일/주/월봉 이미지: 네이버</span></div></div>";
    ov.querySelector(".hc-x").onclick = closeChart;
    ov.querySelectorAll("[data-hcv]").forEach(function (b) { b.onclick = function () { showView(b.getAttribute("data-hcv")); }; });
    var v = load("chartView", "my");
    v = { day: "my", week: "wk", month: "mo" }[v] || v;
    showView(views.some(function (x) { return x[0] === v; }) ? v : "my");
  }
  function dropChart() { if (CV.chart) { try { CV.chart.remove(); } catch (e) {} CV.chart = null; } }
  function closeChart() {
    dropChart();
    var ov = document.getElementById("hcOv"); if (ov) { ov.style.display = "none"; ov.innerHTML = ""; }
  }
  function showView(v) {
    CV.view = v; save("chartView", v); dropChart();
    document.querySelectorAll("[data-hcv]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-hcv") === v); });
    var body = document.getElementById("hcBody");
    if (v === "area") { naverImg(body, v); return; }
    if (v === "inv") { showInvestor(body, CV.code); return; }
    body.innerHTML = "<div class='ht-msg'>차트 불러오는 중…</div>";
    var code = CV.code, loader = v === "min" ? loadMinutes : function (cb) { loadChartOne(code, cb); };
    loadHistory(function () { loader(function (C) { loadLwc(function (ok) {
      if (CV.code !== code || CV.view !== v) return;
      if (!ok) { naverImg(body, KIND[v] ? KIND[v].naver : "area", "차트 프로그램을 불러오지 못해 네이버 이미지로 대신 보여드립니다."); return; }
      if (KIND[v]) {
        var K = KIND[v], ser = C ? C[K.key] : null;
        CV.asof = C ? C.f : "";
        if (!ser || !ser.d || !ser.d.length) {
          naverImg(body, K.naver, "이 종목의 " + K.name + " 자료가 아직 없습니다 (저녁 기록 갱신 때 추가됩니다). 네이버 " + K.name + " 이미지로 대신 보여드립니다 (확대 불가).");
          return;
        }
        drawMy(body, code, ser, v);
      } else {
        var mm = C && C.codes ? C.codes[code] : null;
        if (!mm || !Object.keys(mm).length) {
          naverImg(body, "area", "5분봉은 최근 20영업일 안에 매매한 날과 보유종목 최근 5영업일만 보관합니다. 이 종목은 자료가 없어 네이버 당일 흐름으로 대신 보여드립니다.");
          return;
        }
        drawMin(body, code, mm);
      }
    }); }); });
  }
  // ── 종목별 투자자 매매추이 ([1702], 금액·백만원) — investors/종목코드.js ──
  var INV_ONE = {}, INV_WAIT = {};
  window.__invLoaded = function (code, data) {
    INV_ONE[code] = data;
    var l = INV_WAIT[code] || []; delete INV_WAIT[code];
    l.forEach(function (f) { f(data); });
  };
  function loadInvOne(code, cb) {
    if (INV_ONE.hasOwnProperty(code)) return cb(INV_ONE[code]);
    if (INV_WAIT[code]) { INV_WAIT[code].push(cb); return; }
    INV_WAIT[code] = [cb];
    function miss() { if (INV_WAIT[code]) window.__invLoaded(code, null); }
    loadScript("investors/" + encodeURIComponent(code) + ".js?t=" + Math.floor(Date.now() / 600000), function () { setTimeout(miss, 0); }, miss);
  }
  function showInvestor(body, code) {
    body.innerHTML = "<div class='ht-msg'>투자자 자료 불러오는 중…</div>";
    loadInvOne(code, function (d) {
      if (CV.code !== code || CV.view !== "inv") return;
      if (!d || !d.rows || !d.rows.length) {
        body.innerHTML = "<div class='ht-msg'>이 종목의 투자자 매매추이 자료가 없습니다.<br><small>보유 종목, 최근 90일 안에 매매한 종목, 최근 추세 스캔 종목만 매일 저녁 모아 둡니다.</small><br>" +
          "<a href='https://finance.naver.com/item/frgn.naver?code=" + encodeURIComponent(code) + "' target='_blank' rel='noopener'>네이버 증권 외국인·기관 매매 보기 ↗</a></div>";
        return;
      }
      drawInvestor(body, d);
    });
  }
  // 기간: 버튼(최근 N거래일) 또는 날짜 직접 입력 — 마지막 선택 기억
  function drawInvestor(body, d) {
    var cols = d.cols, all = d.rows;                     // [일자, 종가, 대비, 등락률, 거래량, 개인, 외국인, 기관계, ...] 최신순
    function iso8(x) { x = String(x); return x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6); }
    var newest = iso8(all[0][0]), oldest = iso8(all[all.length - 1][0]);
    var n = +load("invN", "20"), from = load("invFrom", ""), to = load("invTo", "");
    var rows;
    if (n > 0) rows = all.slice(0, n);
    else rows = all.filter(function (r) { var t = iso8(r[0]); return (!from || t >= from) && (!to || t <= to); });
    var showFrom = rows.length ? iso8(rows[rows.length - 1][0]) : (from || oldest), showTo = rows.length ? iso8(rows[0][0]) : (to || newest);
    function eok(v) { return "<span class='" + cls(v) + "'>" + (v > 0 ? "+" : "") + won(v) + "</span>"; }
    var tot = cols.map(function (_, j) { return rows.reduce(function (s, r) { return s + r[5 + j]; }, 0); });
    var first = rows.length ? rows[rows.length - 1] : null, last = rows.length ? rows[0] : null;
    var pchg = first && last && (first[1] - first[2]) ? (last[1] / (first[1] - first[2]) - 1) * 100 : null;   // 기간 주가 등락률
    var btns = [[5, "5일"], [10, "10일"], [20, "20일"], [60, "3개월"], [120, "6개월"], [250, "1년"]].map(function (b) {
      return "<button data-invn='" + b[0] + "' class='" + (n === b[0] ? "on" : "") + "'>" + b[1] + "</button>";
    }).join("");
    var head = ["일자", "종가", "대비", "거래량"].concat(cols);
    var trs = rows.map(function (r) {
      var d8 = String(r[0]);
      return "<tr>" + td(d8.slice(0, 4) + "/" + d8.slice(4, 6) + "/" + d8.slice(6)) + td(won(r[1]), cls(r[2])) +
        td((r[2] > 0 ? "▲ " : r[2] < 0 ? "▼ " : "") + won(Math.abs(r[2])), cls(r[2])) + td(won(r[4])) +
        r.slice(5).map(function (v) { return td(v ? won(v) : "", cls(v)); }).join("") + "</tr>";
    });
    var total = [td("기간 합계"), td(pchg === null ? "" : pct(pchg), cls(pchg)), td(""), td(won(rows.reduce(function (s, r) { return s + r[4]; }, 0)))]
      .concat(tot.map(function (v) { return td(won(v), cls(v)); }));
    body.innerHTML =
      "<div class='hc-range'><span class='ht-seg'>" + btns + "</span>" +
      "<input type='date' id='invFrom' value='" + showFrom + "' min='" + oldest + "' max='" + newest + "'> ~ " +
      "<input type='date' id='invTo' value='" + showTo + "' min='" + oldest + "' max='" + newest + "'></div>" +
      "<div class='ht-sum' style='grid-template-columns:repeat(auto-fit,minmax(150px,1fr))'>" +
      "<div><div class='k'>기간</div><div class='v' style='font-size:13px'>" + showFrom + " ~ " + showTo + " (" + rows.length + "일)</div></div>" +
      "<div><div class='k'>개인 누적 (백만원)</div><div class='v'>" + eok(tot[0]) + "</div></div>" +
      "<div><div class='k'>외국인 누적</div><div class='v'>" + eok(tot[1]) + "</div></div>" +
      "<div><div class='k'>기관계 누적</div><div class='v'>" + eok(tot[2]) + "</div></div>" +
      "<div><div class='k'>기간 주가 등락률</div><div class='v " + cls(pchg) + "'>" + pct(pchg) + "</div></div></div>" +
      table(head, trs, total) +
      "<div class='ht-note'>※ HTS [1702] 종목별 투자자 매매추이와 같은 구성 · 금액 기준 순매수(백만원) · 보관 기간 " + oldest + " ~ " + newest +
      " · 자료 기준일 " + esc(d.f || "") + " (매일 저녁 갱신)<br>※ 외국인 = 등록 외국인, 기타 = 기타법인 + 국가. 맨 위 '기간 합계' 줄이 선택 기간의 누적 순매수입니다.</div>";
    body.querySelectorAll("[data-invn]").forEach(function (b) {
      b.onclick = function () { save("invN", b.getAttribute("data-invn")); drawInvestor(body, d); };
    });
    ["invFrom", "invTo"].forEach(function (id) {
      var el = body.querySelector("#" + id);
      el.onchange = function () {
        save("invN", "0"); save("invFrom", body.querySelector("#invFrom").value); save("invTo", body.querySelector("#invTo").value);
        drawInvestor(body, d);
      };
    });
  }

  function naverImg(body, p, note) {
    var kind = p === "area" ? "area/day" : "candle/" + p;
    body.innerHTML = (note ? "<div class='ht-note' style='margin:0 0 8px'>" + esc(note) + "</div>" : "") +
      "<img class='hc-img' alt='" + esc(CV.name) + " 차트' src='https://ssl.pstatic.net/imgfinance/chart/item/" + kind + "/" +
      encodeURIComponent(CV.code) + ".png?t=" + Math.floor(Date.now() / 60000) + "'>" +
      (p === "area" ? "<div class='ht-note'>※ 오늘 장중 가격 흐름 (네이버 제공, 다시 누르면 새로 고침)</div>" : "");
    var img = body.querySelector("img");
    img.onerror = function () {
      body.innerHTML = (note ? "<div class='ht-note' style='margin:0 0 8px'>" + esc(note) + "</div>" : "") +
        "<div class='ht-msg'>네이버 차트 이미지를 불러오지 못했습니다. 아래 '네이버 증권에서 보기'를 눌러 주세요.</div>";
    };
  }

  // 기간 버튼: items = [[이름, 봉 개수(0=전체)], ...]
  function rangeBar(items) {
    return "<div class='hc-range'>" + items.map(function (it) { return "<button data-rg='" + it[1] + "'>" + it[0] + "</button>"; }).join("") +
      "<label class='hc-mk'><input type='checkbox' id='hcMk'" + (load("chartMarks", "1") === "1" ? " checked" : "") + "> 매매 표시</label>" +
      "<span class='sp'></span><button data-zoom='in' title='확대'>＋</button><button data-zoom='out' title='축소'>－</button></div>";
  }
  function bindRange(body, chart, n, dayStarts) {
    var ts = chart.timeScale();
    body.querySelectorAll("[data-rg]").forEach(function (b) {
      b.onclick = function () {
        var k = +b.getAttribute("data-rg");
        if (!k) { ts.fitContent(); return; }
        // 분봉은 'k일' 단위 (dayStarts: 각 날짜 첫 봉 위치), 일봉은 'k봉'
        var from = dayStarts ? dayStarts[Math.max(0, dayStarts.length - k)] : n - k;
        ts.setVisibleLogicalRange({ from: Math.max(-1, from - 1), to: n + 1 });
      };
    });
    body.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.onclick = function () {
        var r = ts.getVisibleLogicalRange(); if (!r) return;
        var c = (r.from + r.to) / 2, half = (r.to - r.from) / 2 * (b.getAttribute("data-zoom") === "in" ? 0.6 : 1.6);
        half = Math.max(5, half);
        ts.setVisibleLogicalRange({ from: c - half, to: c + half });
      };
    });
  }
  // 마우스를 올린(손가락으로 누른) 봉 옆에 뜨는 정보 상자
  function tipBox(el) {
    var t = document.createElement("div"); t.className = "hc-tip"; el.appendChild(t);
    return {
      show: function (p, html) {
        if (!p || !p.point || p.point.x < 0 || p.point.y < 0) { t.style.display = "none"; return; }
        t.innerHTML = html; t.style.display = "block";
        var w = t.offsetWidth, h = t.offsetHeight, W = el.clientWidth, H = el.clientHeight;
        var x = p.point.x + 16, y = p.point.y + 16;
        if (x + w > W - 60) x = p.point.x - w - 16;
        if (y + h > H - 30) y = Math.max(4, p.point.y - h - 16);
        t.style.left = Math.max(4, x) + "px"; t.style.top = y + "px";
      },
      hide: function () { t.style.display = "none"; }
    };
  }
  function tipRow(k, v, c) { return "<tr><td>" + k + "</td><td class='" + (c || "") + "'>" + v + "</td></tr>"; }

  // 매매 표시 켜기/끄기 (기억함)
  function bindMarks(body, series, markers) {
    var cb = body.querySelector("#hcMk");
    function apply() { series.setMarkers(cb && cb.checked ? markers : []); }
    if (cb) cb.onchange = function () { save("chartMarks", cb.checked ? "1" : "0"); apply(); };
    apply();
  }
  function baseChart(el, intraday) {
    var LW = window.LightweightCharts;
    var chart = LW.createChart(el, {
      width: el.clientWidth, height: el.clientHeight,
      layout: { background: { color: "#ffffff" }, textColor: "#333", fontSize: 11 },
      grid: { vertLines: { color: "#f1f1f1" }, horzLines: { color: "#f1f1f1" } },
      rightPriceScale: { borderColor: "#ddd" },
      timeScale: { borderColor: "#ddd", rightOffset: 3, timeVisible: !!intraday, secondsVisible: false },
      localization: { locale: "ko-KR", priceFormatter: function (p) { return Math.round(p).toLocaleString("ko-KR"); },
        timeFormatter: intraday ? function (t) { return md(t) + " " + hm(t); } : undefined }
    });
    CV.chart = chart;
    window.addEventListener("resize", function () { if (CV.chart === chart) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }); });
    return chart;
  }
  function candles(chart) {
    return chart.addCandlestickSeries({ upColor: "#d32f2f", downColor: "#1565c0", borderUpColor: "#d32f2f", borderDownColor: "#1565c0",
      wickUpColor: "#d32f2f", wickDownColor: "#1565c0" });
  }
  function line(chart, color, w) {
    return chart.addLineSeries({ color: color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  }

  // ── 매매 일봉 ──
  // 매매일이 어느 봉에 들어가는지: 일봉=그날, 주봉=그 주(월요일 기준), 월봉=그 달
  function bucketOf(dateIso, kind) {
    if (kind === "mo") return dateIso.slice(0, 7);
    if (kind === "wk") {
      var x = new Date(Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10)));
      x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7);
      return x.toISOString().slice(0, 10);
    }
    return dateIso;
  }
  function drawMy(body, code, ch, kind) {
    kind = kind || "my";
    var K = KIND[kind], U = K.unit;
    var trades = myTrades(code);
    body.innerHTML = rangeBar(K.ranges) +
      "<div class='hc-legend' id='hcLeg'></div><div class='hc-chart' id='hcChart'></div><div class='hc-trades' id='hcTrades'></div>";
    var el = document.getElementById("hcChart"), chart = baseChart(el, false);
    var bars = ch.d.map(function (d, i) { return { time: dstr(d), open: ch.o[i], high: ch.h[i], low: ch.l[i], close: ch.c[i] }; });
    // 시가·고가·저가가 없는 자료(종가만)는 캔들 대신 선으로
    var flat = bars.length > 2 && bars.slice(0, -1).every(function (b) { return b.open === b.close && b.high === b.low; });
    var candle = flat ? chart.addLineSeries({ color: "#3b4ab0", lineWidth: 2, priceLineVisible: true }) : candles(chart);
    candle.setData(flat ? bars.map(function (b) { return { time: b.time, value: b.close }; }) : bars);
    var m10 = ma(ch.c, 10), m20 = ma(ch.c, 20);
    line(chart, "#ef6c00", 1).setData(bars.map(function (b, i) { return m10[i] === null ? { time: b.time } : { time: b.time, value: m10[i] }; }));
    line(chart, "#2e7d32", 2).setData(bars.map(function (b, i) { return m20[i] === null ? { time: b.time } : { time: b.time, value: m20[i] }; }));
    var first = bars[0].time, last = bars[bars.length - 1].time, barOfKey = {};
    bars.forEach(function (b, i) { barOfKey[bucketOf(b.time, kind)] = i; });
    // 같은 봉·같은 구분의 매매는 하나로 합쳐 표시
    var agg = {};
    trades.forEach(function (t) {
      var i = barOfKey[bucketOf(t.date, kind)];
      if (i === undefined) return;
      var k = i + "|" + t.side, r = agg[k] || (agg[k] = { i: i, side: t.side, qty: 0, amt: 0 });
      r.qty += t.qty; r.amt += t.amt;
    });
    var aggList = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return a.i - b.i; });
    var markers = aggList.map(function (r) {
      var buy = r.side === "매수";
      return { time: bars[r.i].time, position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? "#d32f2f" : "#1565c0", text: (buy ? "매수 " : "매도 ") + won(r.qty) };
    });
    bindMarks(body, candle, markers);
    var showN = { my: 120, wk: 104, mo: 120 }[kind], pad = { my: 30, wk: 10, mo: 6 }[kind];
    var idx = Math.max(0, bars.length - showN);
    if (aggList.length) idx = Math.min(idx, aggList[0].i);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - pad), to: bars.length + 2 });
    bindRange(body, chart, bars.length, null);
    var leg = document.getElementById("hcLeg"), byTime = {};
    bars.forEach(function (b, i) { byTime[b.time] = i; });
    function legend(i) {
      var b = bars[i], prev = i > 0 ? bars[i - 1].close : null, chg = prev ? (b.close / prev - 1) * 100 : null;
      var tr = aggList.filter(function (r) { return r.i === i; }).map(function (r) {
        return "<b style='color:" + (r.side === "매수" ? "#d32f2f" : "#1565c0") + "'>" + r.side + " " + won(r.qty) + "주 @" + won(r.amt / r.qty) + "</b>";
      }).join("");
      var lbl = kind === "my" ? b.time : kind === "wk" ? b.time + " 주" : b.time.slice(0, 7);
      leg.innerHTML = "<b>" + lbl + "</b><b>시 " + won(b.open) + "</b><b>고 " + won(b.high) + "</b><b>저 " + won(b.low) + "</b><b>종 " + won(b.close) +
        "</b><b class='" + cls(chg) + "'>" + pct(chg) + "</b><b style='color:#ef6c00'>10" + U + "선 " + won(m10[i]) + "</b><b style='color:#2e7d32'>20" + U + "선 " + won(m20[i]) + "</b>" + tr;
    }
    legend(bars.length - 1);
    var tip = tipBox(el);
    function tipHtml(i, lbl) {
      var b = bars[i], prev = i > 0 ? bars[i - 1].close : null, chg = prev ? (b.close / prev - 1) * 100 : null;
      var amp = b.low ? (b.high / b.low - 1) * 100 : null;
      var tr = aggList.filter(function (r) { return r.i === i; }).map(function (r) {
        return "<div class='tr' style='color:" + (r.side === "매수" ? "#d32f2f" : "#1565c0") + "'>" + (r.side === "매수" ? "▲ " : "▼ ") + r.side + " " + won(r.qty) + "주 @" + won(r.amt / r.qty) + "</div>";
      }).join("");
      // 시가·고가·저가·종가마다 전 봉 종가 대비 등락률 (HTS처럼)
      function pv(v) {
        var r = prev ? (v / prev - 1) * 100 : null;
        return "<span class='" + cls(r) + "'>" + won(v) + "</span> <small class='" + cls(r) + "'>(" + pct(r) + ")</small>";
      }
      return "<div class='t'>" + lbl + "</div><table>" + tipRow("시가", pv(b.open)) + tipRow("고가", pv(b.high)) + tipRow("저가", pv(b.low)) +
        tipRow("종가", pv(b.close)) + tipRow("전 봉 종가", won(prev)) + tipRow("고저 폭", amp === null ? "-" : amp.toFixed(2) + "%") +
        tipRow("10" + U + "선", won(m10[i])) + tipRow("20" + U + "선", won(m20[i])) + "</table>" + tr;
    }
    chart.subscribeCrosshairMove(function (p) {
      if (!p || !p.time) { legend(bars.length - 1); tip.hide(); return; }
      var t = typeof p.time === "string" ? p.time : (p.time.year + "-" + ("0" + p.time.month).slice(-2) + "-" + ("0" + p.time.day).slice(-2));
      var i = byTime[t];
      if (i === undefined) { tip.hide(); return; }
      legend(i);
      var b = bars[i], lbl = kind === "my" ? b.time + " (" + "일월화수목금토"[new Date(b.time + "T00:00:00Z").getUTCDay()] + ")" :
        kind === "wk" ? b.time + " 주" : b.time.slice(0, 4) + "년 " + (+b.time.slice(5, 7)) + "월";
      tip.show(p, tipHtml(i, lbl));
    });
    var rows = trades.slice().reverse().map(function (t) {
      return "<tr>" + td(t.date) + td(t.side, t.side === "매수" ? "up" : "down") + td(won(t.qty)) + td(won(t.amt / t.qty)) + td(won(t.amt)) +
        td(t.pnl === null ? "-" : won(t.pnl), t.pnl === null ? "" : cls(t.pnl)) + "</tr>";
    });
    var out = trades.filter(function (t) { return barOfKey[bucketOf(t.date, kind)] === undefined; }).length;
    if (String(code).indexOf("IDX") === 0) {
      document.getElementById("hcTrades").innerHTML = "<div class='ht-note'>※ 지수 " + (kind === "my" ? "일봉" : kind === "wk" ? "주봉" : "월봉") +
        " · 주황선 10" + U + "선 · 초록선 20" + U + "선 · 30분마다 갱신(오늘 봉은 1분마다) · 확대·축소: 마우스 휠 / 두 손가락</div>";
      return;
    }
    document.getElementById("hcTrades").innerHTML = trades.length ?
      table(["매매일", "구분", "수량", "평균단가", "금액", "실현손익"], rows) +
      "<div class='ht-note'>▲ 매수 · ▼ 매도 (계좌: " + esc(account()) + (kind === "my" ? "" : ", 같은 " + (kind === "wk" ? "주" : "달") + " 매매는 합쳐서 표시") +
      ") · 주황선 10" + U + "선 · 초록선 20" + U + "선 · 수정주가 기준" +
      (out ? " · 차트 기간 밖 매매 " + out + "건은 표에만 표시" : "") + " · 자료 기준일: " + esc(CV.asof || "") + "<br>" +
      "※ 확대·축소: 마우스 휠 / 두 손가락 벌리기·오므리기, 이동: 끌기, 처음 상태: 날짜 눈금 더블클릭</div>" :
      "<div class='ht-note'>선택한 계좌(" + esc(account()) + ")에는 이 종목 매매 기록이 없습니다. 기록 탭의 계좌 선택을 바꿔 보세요.</div>";
  }

  // ── 매매 5분봉 ──
  function drawMin(body, code, mm) {
    var days = Object.keys(mm).sort(), bars = [], dayStarts = [];
    days.forEach(function (d) {
      var m = mm[d];
      dayStarts.push(bars.length);
      m.t.forEach(function (t, i) {
        bars.push({ time: utc(d, t), open: m.o[i], high: m.h[i], low: m.l[i], close: m.c[i], day: d, hhmm: t });
      });
    });
    var execs = myExecs(code).filter(function (e) { return mm[e.date]; });
    body.innerHTML = rangeBar([["1일", 1], ["3일", 3], ["5일", 5], ["10일", 10], ["전체", 0]]) +
      "<div class='hc-legend' id='hcLeg'></div><div class='hc-chart' id='hcChart'></div><div class='hc-trades' id='hcTrades'></div>";
    var el = document.getElementById("hcChart"), chart = baseChart(el, true), candle = candles(chart);
    candle.setData(bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    var m20 = ma(bars.map(function (b) { return b.close; }), 20);
    line(chart, "#2e7d32", 1).setData(bars.map(function (b, i) { return m20[i] === null ? { time: b.time } : { time: b.time, value: m20[i] }; }));
    // 체결 → 그 시각이 속한 봉 (같은 봉·같은 구분은 합침)
    var times = bars.map(function (b) { return b.time; });
    function barOf(e) {
      var t = utc(e.date, e.time.slice(0, 4)), lo = 0, hi = times.length - 1, ans = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
      return ans >= 0 && bars[ans].day === e.date ? ans : -1;
    }
    var g = {};
    execs.forEach(function (e) {
      var i = barOf(e); if (i < 0) return;
      var k = i + "|" + e.side, r = g[k] || (g[k] = { i: i, side: e.side, qty: 0, amt: 0, list: [] });
      r.qty += e.qty; r.amt += e.qty * e.price; r.list.push(e);
    });
    var marks = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return a.i - b.i; });
    bindMarks(body, candle, marks.map(function (r) {
      var buy = r.side === "매수";
      return { time: bars[r.i].time, position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? "#d32f2f" : "#1565c0", text: (buy ? "매수 " : "매도 ") + won(r.qty) };
    }));
    // 처음 보이는 범위: 가장 최근 매매일 하루
    var focus = execs.length ? execs[execs.length - 1].date : days[days.length - 1];
    var fi = days.indexOf(focus), fs = dayStarts[fi], fe = fi + 1 < dayStarts.length ? dayStarts[fi + 1] - 1 : bars.length - 1;
    chart.timeScale().setVisibleLogicalRange({ from: fs - 2, to: fe + 3 });
    bindRange(body, chart, bars.length, dayStarts);
    var leg = document.getElementById("hcLeg"), byTime = {};
    bars.forEach(function (b, i) { byTime[b.time] = i; });
    function legend(i) {
      var b = bars[i], open0 = mm[b.day].o[0], chg = open0 ? (b.close / open0 - 1) * 100 : null;
      var tr = marks.filter(function (r) { return r.i === i; }).map(function (r) {
        return "<b style='color:" + (r.side === "매수" ? "#d32f2f" : "#1565c0") + "'>" + r.list.map(function (e) {
          return e.side + " " + e.time.slice(0, 2) + ":" + e.time.slice(2, 4) + ":" + e.time.slice(4, 6) + " " + won(e.qty) + "주 @" + won(e.price);
        }).join(", ") + "</b>";
      }).join("");
      leg.innerHTML = "<b>" + b.day + " " + b.hhmm.slice(0, 2) + ":" + b.hhmm.slice(2) + "</b><b>시 " + won(b.open) + "</b><b>고 " + won(b.high) +
        "</b><b>저 " + won(b.low) + "</b><b>종 " + won(b.close) + "</b><b class='" + cls(chg) + "'>시가대비 " + pct(chg) + "</b>" +
        "<b style='color:#2e7d32'>20봉선 " + won(m20[i]) + "</b>" + tr;
    }
    legend(fe);
    var tip = tipBox(el);
    chart.subscribeCrosshairMove(function (p) {
      if (!p || p.time === undefined || p.time === null) { legend(fe); tip.hide(); return; }
      var i = byTime[p.time];
      if (i === undefined) { tip.hide(); return; }
      legend(i);
      var b = bars[i], prev = i > 0 && bars[i - 1].day === b.day ? bars[i - 1].close : null;
      var chg = prev ? (b.close / prev - 1) * 100 : null, open0 = mm[b.day].o[0], chg0 = open0 ? (b.close / open0 - 1) * 100 : null;
      var end = utc(b.day, b.hhmm) + ((MINUTES && MINUTES.ncnt) || 5) * 60;
      var tr = marks.filter(function (r) { return r.i === i; }).map(function (r) {
        return r.list.map(function (e) {
          return "<div class='tr' style='color:" + (e.side === "매수" ? "#d32f2f" : "#1565c0") + "'>" + (e.side === "매수" ? "▲ " : "▼ ") + e.side + " " +
            e.time.slice(0, 2) + ":" + e.time.slice(2, 4) + ":" + e.time.slice(4, 6) + " " + won(e.qty) + "주 @" + won(e.price) + "</div>";
        }).join("");
      }).join("");
      tip.show(p, "<div class='t'>" + b.day + " " + b.hhmm.slice(0, 2) + ":" + b.hhmm.slice(2) + "~" + hm(end) + "</div><table>" +
        tipRow("시가", won(b.open)) + tipRow("고가", won(b.high), "up") + tipRow("저가", won(b.low), "down") + tipRow("종가", won(b.close), cls(chg)) +
        tipRow("전봉 대비", pct(chg), cls(chg)) + tipRow("당일 시가 대비", pct(chg0), cls(chg0)) + tipRow("20봉선", won(m20[i])) + "</table>" + tr);
    });
    var rows = execs.slice().reverse().map(function (e) {
      return "<tr>" + td(e.date) + td(e.time.slice(0, 2) + ":" + e.time.slice(2, 4) + ":" + e.time.slice(4, 6)) + td(e.side, e.side === "매수" ? "up" : "down") +
        td(won(e.qty)) + td(won(e.price)) + td(won(e.qty * e.price)) + (account() === ALL ? td(e.acc) : "") + "</tr>";
    });
    var head = ["매매일", "체결 시각", "구분", "수량", "체결가", "금액"].concat(account() === ALL ? ["계좌"] : []);
    document.getElementById("hcTrades").innerHTML = (execs.length ? table(head, rows) :
      "<div class='ht-note'>보관 중인 5분봉 기간(" + days[0] + " ~ " + days[days.length - 1] + ")에 선택한 계좌(" + esc(account()) + ")의 이 종목 체결이 없습니다.</div>") +
      "<div class='ht-note'>▲ 매수 · ▼ 매도 = 실제 체결 시각이 속한 5분봉 · 초록선 20봉 이동평균 · 보관: 최근 20영업일 매매일 + 보유종목 최근 5영업일" +
      " · 기준: " + esc((MINUTES && MINUTES.generated_at) || "") + " (매일 저녁 갱신 — 오늘 장중 흐름은 '당일 흐름' 탭)<br>" +
      "※ 확대·축소: 마우스 휠 / 두 손가락 벌리기·오므리기, 이동: 끌기 · 날짜 사이 장 마감 시간은 건너뛰고 이어 붙여 그립니다.</div>";
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-code]") : null;
    if (!el) return;
    e.preventDefault();
    openChart(el.getAttribute("data-code"), (el.textContent || "").trim());
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeChart(); });

  // ── 추세 스캔 (scan.py 15:10 결과: 1순위-A·B, 2순위 미너비니 8/8) ──
  var SCAN = null;
  function renderScan() {
    var box = document.getElementById("tab-history");
    if (!SCAN) {
      box.innerHTML = "<div class='ht-msg'>스캔 결과를 불러오는 중…</div>";
      loadData("scan_result.json", "scan_data.js", "SCAN_DATA", function (j) {
        SCAN = j || { scans: {} };
        if (S.tab === "scan") renderScan();
      });
      return;
    }
    var days = Object.keys(SCAN.scans || {}).sort().reverse();
    if (!days.length) {
      box.innerHTML = "<div class='ht-msg'>아직 스캔 결과가 없습니다.<br><small>scan.py(매일 15:10)가 실행되면 여기에 표시됩니다.</small></div>";
      return;
    }
    var day = load("scanDate", "");
    if (days.indexOf(day) < 0) day = days[0];
    var sc = SCAN.scans[day];
    var mkt = document.querySelector("#tab-holdings .mkt-bar"), mktNote = document.querySelector("#tab-holdings .mkt-note");
    function nameCell(x) {
      return "<td class='name' style='text-align:left' data-code='" + esc(x.code) + "'>" + esc(x.name) + "</td>";
    }
    function mcell(x) { return td(x.passed + "/" + x.avail, x.passed === x.avail && x.avail === 8 ? "up" : ""); }
    function block(key, title, list, extra) {
      var tab = "scan" + key;
      var recs = sortRecs(tab, list.map(function (x, i) { x._rank = i + 1; return x; }), {
        rank: function (x) { return x._rank; }, name: function (x) { return x.name; }, mcap: function (x) { return x.mcap; },
        rate: function (x) { return x.rate; }, brk: function (x) { return x.brk; }, drop: function (x) { return x.drop; },
        rs: function (x) { return x.rs; }, price: function (x) { return x.price; }
      });
      var head = [sh(tab, "순위", "rank"), sh(tab, "종목명", "name"), "시장", sh(tab, "시총(억)", "mcap"), sh(tab, "현재가", "price"),
        sh(tab, "등락률", "rate")].concat(extra ? ["당일고가", sh(tab, "고가대비", "drop")] : []).concat(
        ["역사적 신고가", sh(tab, "신고가 대비", "brk"), sh(tab, "RS", "rs"), "미너비니"]);
      var rows = recs.map(function (x) {
        return "<tr>" + td(x._rank) + nameCell(x) + td(esc(x.market || "")) + td(won(x.mcap)) + td(won(x.price)) + td(pct(x.rate), cls(x.rate)) +
          (extra ? td(won(x.high)) + td(pct(x.drop), cls(x.drop)) : "") +
          td(won(x.ath)) + td(pct(x.brk), cls(x.brk)) + td(x.rs === null || x.rs === undefined ? "-" : x.rs) + mcell(x) + "</tr>";
      });
      return "<h3>" + title + " <small style='color:#888;font-weight:normal'>" + list.length + "종목</small></h3>" +
        (list.length ? table(head, rows) : "<div class='ht-msg'>없음</div>");
    }
    // 시장 현황 칸 복사: 그래프 색 구분(clipPath) id가 겹치면 숨은 보유현황 쪽을 가리켜 색이 안 나오므로 id를 바꿔서 복사
    var ovb = document.querySelector("#tab-holdings .ov-bar");
    function cloneHtml(el) { return el ? el.outerHTML.replace(/(sp[ud]\d+)/g, "$1_scan") : ""; }
    box.innerHTML = cloneHtml(ovb) + (mkt ? cloneHtml(mkt) + (mktNote ? mktNote.outerHTML : "") : "") +
      "<div class='ht-bar'><span>스캔일</span><select id='scanDate'>" + days.map(function (d) {
        return "<option value='" + d + "'" + (d === day ? " selected" : "") + ">" + d + " (" + (SCAN.scans[d].time || "") + ")</option>";
      }).join("") + "</select><small style='color:#888'>매일 15:10 스캔 · 최근 " + days.length + "거래일 보관</small></div>" +
      (sc.warn ? "<div class='ht-msg' style='color:#c62828;text-align:left'>" + esc(sc.warn) + "</div>" : "") +
      sumBoxes([["1순위-A 돌파 유지", sc.a.length + "종목", "up"], ["1순위-B 장중 돌파 후 밀림", sc.b.length + "종목"],
        ["2순위 미너비니 8/8", sc.s.length + "종목"], ["현재가 누락", (sc.missing || 0) + "종목"]]) +
      block("A", "1순위-A 돌파 유지 (현재가 ≥ 역사적 신고가)", sc.a, false) +
      block("B", "1순위-B 장중 돌파 후 밀림 (고가 ≥ 신고가 > 현재가)", sc.b, true) +
      block("S", "2순위 미너비니 8/8 (역사적 신고가에 가까운 순)", sc.s, false) +
      "<div class='ht-note'>※ 대상: 시가총액 5천억 원 이상. 역사적 신고가 = 어제까지 KRX 고가 최고값. 신고가 대비 = 현재가 ÷ 역사적 신고가 − 1.<br>" +
      "※ 스캔 시각(15:10) 기준 값입니다. 제목을 누르면 다시 정렬됩니다. 종목명을 누르면 차트가 열립니다 (매매한 적 없는 종목은 네이버 차트 그림).</div>";
    var sel = box.querySelector("#scanDate");
    if (sel) sel.onchange = function () { save("scanDate", sel.value); renderScan(); };
    bindBar(box);
  }

  // ── 그리기 ──
  function render() {
    var box = document.getElementById("tab-history");
    if (S.tab === "scan") return renderScan();
    if (!DATA) return;
    var a = acc();
    var body;
    if (!a) body = "<div class='ht-msg'>" + esc(account()) + " 기록이 없습니다.</div>";
    else if (S.tab === "trades") body = viewTrades(a);
    else if (S.tab === "daily") body = viewDaily(a);
    else if (S.tab === "assetret" && S.from && S.from === S.to) body = compareView(a);
    else if (S.tab === "assetret") body = viewAssetReturn(a);
    else if (S.tab === "stats") body = viewStats(a);
    else body = viewAssetReturn(a);
    box.innerHTML = filterBar() + body +
      "<div class='ht-note'>기록 기준: " + esc(DATA.generated_at || "") + " (매일 저녁 갱신, 보관 기간 " + esc(DATA.start || "") + " ~ " + esc(DATA.end || "") + ")</div>";
    bindBar(box);
  }

  function init() {
    injectStyle();
    if (!buildShell()) return;
    S.unit = load("unit", "day");
    S.preset = load("preset", "1m");
    S.acct = load("acct", ALL);
    // 보유현황 계좌: 주소(#계좌명)가 없으면 기록 탭에서 마지막에 고른 계좌로 맞춤
    if (!location.hash && window.switchAccount && S.acct) window.switchAccount(S.acct);
    var r = presetRange(S.preset || "1m"); S.from = r[0]; S.to = r[1];
    var tab = load("tab", "holdings");
    tab = { journal: "trades", realized: "trades", asset: "assetret", "return": "assetret" }[tab] || tab;   // 예전 탭 이름
    setTab(TABS.some(function (t) { return t.id === tab; }) ? tab : "holdings");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
