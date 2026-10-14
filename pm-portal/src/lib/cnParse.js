// 설계변경(CN) 분석 — Axcelis PLM 「CN Summary(HTML)」를 읽어 리비전 · BOM · 신규/단종 품번을 뽑는다 (2026-10-14)
//   김교한 차장이 만든 단일 HTML 「AXCELIS CN 분석기」의 파서 · 가공 · 한국어 변환 규칙을 그대로 옮겼다.
//   화면(React)과 저장(DB)은 pages/quality/CnHistory.jsx 에서 한다.
//   ⚠ 파서는 브라우저 DOMParser 를 쓴다. 저장할 때는 결과(JSON)만 남기고, 다시 볼 때는 derive 만 다시 돌린다.


export function usDate(v) {
  if (!v) return '';
  const m = /^(\d{2})-(\d{2})-(\d{4})(-?)$/.exec(String(v).trim());
  if (!m) return String(v).trim();
  return `${m[3]}-${m[1]}-${m[2]}${m[4] ? '~' : ''}`;
}

/* <br> 만 줄바꿈으로. 원본 줄바꿈(단순 자동 줄맞춤)은 공백으로 */
export function txtBr(node) {
  if (!node) return '';
  const c = node.cloneNode(true);
  c.querySelectorAll('br').forEach(b => b.replaceWith('\u0001'));
  return c.textContent.replace(/\s+/g, ' ').split('\u0001')
    .map(s => s.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const txt = n => n ? n.textContent.replace(/\s+/g, ' ').trim() : '';

const SECT = [
  ['PART REFERENCED ON DOCUMENT', 'partRefOnDoc'],
  ['DOCUMENT REFERENCED ON DOCUMENT', 'docRefOnDoc'],
  ['DESCRIBED BY DOCUMENT', 'describedBy'],
  ['REFERENCED DOCUMENT CHANGES', 'refDoc'],
  ['REFERENCES DOCUMENT CHANGES', 'refDoc'],
  ['AML CHANGES', 'aml'],
  ['ATL SHARING', 'atl'],
  ['BOM SUMMARY', 'bom'],
  ['WHERE-USED', 'whereUsed'],
];
export function sectKey(label) {
  const L = label.toUpperCase();
  for (const [k, v] of SECT) if (L.includes(k)) return v;
  return null;
}

function tableRows(tbl) {
  const trs = [...tbl.querySelectorAll('tr')];
  if (!trs.length) return { head: [], rows: [] };
  const head = [...trs[0].children].map(c => txt(c));
  const rows = trs.slice(1).map(tr => [...tr.children].map(c => txt(c)));
  return { head, rows };
}

export function parseCN(html, fileName) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = [...doc.body.children];

  const cn = {
    fileName, number: '', title: '', plmUrl: '',
    reason: '', solution: '', parts: [], bomAll: [], totalBom: null,
    parsedAt: new Date()
  };

  /* --- 머리말 --- */
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.tagName === 'TABLE') break;
    const t = txt(n);
    if (!cn.number) {
      const a = n.querySelector && n.querySelector('a');
      const m = /^(N\d+)\s*[-–]\s*(.*)$/.exec(t);
      if (m) { cn.number = m[1]; cn.title = m[2]; if (a) cn.plmUrl = a.href; continue; }
    }
    if (/^REASON FOR CHANGE/i.test(t)) { cn.reason = txtBr(nodes[i + 1]); i++; continue; }
    if (/^SOLUTION/i.test(t)) { cn.solution = txtBr(nodes[i + 1]); i++; continue; }
  }
  if (!cn.number) {
    const m = /N\d{7}/.exec(fileName || '');
    cn.number = m ? m[0] : '(번호 없음)';
  }

  /* --- 품목 블록 경계 --- */
  const isHead = n => n.tagName === 'TABLE' && n.textContent.includes('FROM DESCRIPTION:');
  const starts = [];
  nodes.forEach((n, i) => { if (isHead(n)) starts.push(i); });

  let endAll = nodes.length;
  for (let i = (starts[starts.length - 1] || 0); i < nodes.length; i++) {
    const t = txt(nodes[i]);
    if (/DEFERRED BOM MAINTENANCE/i.test(t) || /^BOM SUMMARIES/i.test(t)) { endAll = i; break; }
  }

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = (s + 1 < starts.length) ? starts[s + 1] : endAll;
    cn.parts.push(parsePart(nodes.slice(from, to), s + 1));
  }

  /* --- 통합 BOM SUMMARIES --- */
  for (let i = endAll; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.tagName === 'TABLE' && n.textContent.includes('ASSEMBLY BOM #')) {
      const { head, rows } = tableRows(n);
      const ix = k => head.findIndex(h => h.toUpperCase() === k);
      const c = {
        act: ix('ACT'), assy: ix('ASSEMBLY BOM #'), pn: ix('PART #'), name: ix('NAME'),
        fr: ix('FROM REV'), tr: ix('TO REV'), ft: ix('FROM TYPE'), tt: ix('TO TYPE'),
        fq: ix('FROM QTY'), tq: ix('TO QTY'), bg: ix('BEGIN')
      };
      rows.forEach(r => cn.bomAll.push({
        act: r[c.act] || '', assy: r[c.assy] || '', pn: r[c.pn] || '', name: r[c.name] || '',
        fromRev: r[c.fr] || '', toRev: r[c.tr] || '', fromType: r[c.ft] || '', toType: r[c.tt] || '',
        fromQty: r[c.fq] || '', toQty: r[c.tq] || '', begin: r[c.bg] || ''
      }));
    }
    const t = txt(n);
    const m = /Total Part # BOM add\/change\/delete\s*=\s*(\d+)/i.exec(t);
    if (m) cn.totalBom = Number(m[1]);
  }

  /* 통합표가 없으면 품목별 BOM 을 모아 대체 */
  if (!cn.bomAll.length) {
    cn.parts.forEach(p => (p.sections.bom || []).forEach(b => cn.bomAll.push({ ...b, assy: p.partNo })));
  }
  if (cn.totalBom == null) cn.totalBom = cn.bomAll.length;

  return cn;
}

function parsePart(block, no) {
  const p = {
    no, partNo: '', plm: '', task: '', fromDesc: '', toDesc: '',
    erpEff: '', fromRev: '', toRev: '', dispWip: '', dispOo: '', dispInv: '',
    tier: '', comments: '', rework: '', planner: '',
    fromSimilar: '', toSimilar: '', sections: {}
  };

  let lastLabel = null;
  for (const n of block) {
    if (n.tagName === 'P') {
      const t = txt(n);
      lastLabel = /^NO\s/i.test(t) ? null : t;
      continue;
    }
    if (n.tagName !== 'TABLE') continue;
    const tt = n.textContent;

    if (tt.includes('FROM DESCRIPTION:')) {
      const trs = [...n.querySelectorAll('tr')];
      if (trs[0]) {
        const c = trs[0].children;
        p.partNo = txt(c[0]);
        const a = c[0] && c[0].querySelector('a'); if (a) p.plm = a.href;
        p.fromDesc = txt(c[2]);
      }
      if (trs[1]) { const c = trs[1].children; p.task = txt(c[0]); p.toDesc = txt(c[2]); }
      continue;
    }
    if (tt.includes('ERP CURR EFF')) {
      [...n.querySelectorAll('td')].forEach(td => {
        const s = txt(td); const i = s.indexOf(':');
        if (i < 0) return;
        const k = s.slice(0, i).trim().toUpperCase(), v = s.slice(i + 1).trim();
        if (k === 'ERP CURR EFF') p.erpEff = v;
        else if (k === 'FROM') p.fromRev = v;
        else if (k === 'TO') p.toRev = v;
        else if (k === 'DISP WIP') p.dispWip = v;
        else if (k === 'DISP OO') p.dispOo = v;
        else if (k === 'DISP INVENTORY') p.dispInv = v;
      });
      continue;
    }
    if (tt.includes('CHANGE COMMENTS')) {
      [...n.querySelectorAll('td')].forEach(td => {
        const s = txt(td).toUpperCase();
        const sp = td.querySelector('span');
        if (s.startsWith('TIER METRICS')) p.tier = txt(sp);
        else if (s.startsWith('CHANGE COMMENTS')) p.comments = txtBr(sp);
        else if (s.startsWith('REWORK INSTRUCTIONS')) p.rework = txtBr(sp);
        else if (s.startsWith('PLANNER COMMENTS')) p.planner = txtBr(sp);
      });
      continue;
    }
    if (tt.includes('FROM SIMILAR TO')) {
      const td = [...n.querySelectorAll('td')].map(x => txt(x));
      const i = td.findIndex(x => /^FROM SIMILAR TO$/i.test(x));
      const j = td.findIndex(x => /^TO SIMILAR TO$/i.test(x));
      if (i >= 0) p.fromSimilar = td[i + 1] || '';
      if (j >= 0) p.toSimilar = td[j + 1] || '';
      continue;
    }
    /* 나머지 = 직전 라벨의 요약표 */
    if (!lastLabel) continue;
    const key = sectKey(lastLabel);
    if (!key) { lastLabel = null; continue; }
    const { head, rows } = tableRows(n);
    const H = head.map(h => h.toUpperCase());
    const ix = k => H.indexOf(k);

    if (key === 'bom') {
      const c = { act: ix('ACT'), pn: ix('PART #'), name: ix('NAME'), fr: ix('FROM REV'), tr: ix('TO REV'), ft: ix('FROM TYPE'), tt2: ix('TO TYPE'), fq: ix('FROM QTY'), tq: ix('TO QTY'), bg: ix('BEGIN') };
      p.sections.bom = rows.map(r => ({
        act: r[c.act] || '', pn: r[c.pn] || '', name: r[c.name] || '',
        fromRev: r[c.fr] || '', toRev: r[c.tr] || '', fromType: r[c.ft] || '', toType: r[c.tt2] || '',
        fromQty: r[c.fq] || '', toQty: r[c.tq] || '', begin: r[c.bg] || ''
      }));
    } else if (key === 'whereUsed') {
      const c = { w: ix('WHERE USED'), d: ix('DESCRIPTION'), s: ix('SOS'), ps: ix('PARENT SOS') };
      p.sections.whereUsed = rows.map(r => ({
        pn: (r[c.w] || '').replace(/^\./, ''), name: r[c.d] || '', sos: r[c.s] || '', psos: r[c.ps] || ''
      }));
    } else {
      p.sections[key] = rows.map(r => ({ head, cells: r }));
    }
    lastLabel = null;
  }
  return p;
}

const KIND = [
  [/\bHARN\b|HARNESS/, '하네스', 'b-pr'],
  [/\bASSY\b/, '어셈블리', 'b-blue'],
  [/\bWIRE\b|\bCBL\b|CABLE/, '전선', 'b-blue'],
  [/\bLBL\b|LABEL/, '라벨', 'b-gray'],
  [/SCHEM/, '회로도', 'b-gray'],
  [/\bSPEC\b|ENG INFO|STANDARD|MARKING|TORQUE/, '문서·규격', 'b-gray'],
  [/BRKT|CHAS|\bPNL\b|PLATE|RAIL|COVER|ENCL/, '기구·판금', 'b-green'],
  [/SCR |WASHER|NUT |FERRULE|LUG|TERM|STOPPER/, '체결·단자', 'b-gray'],
];
const RE_MFG = /_[A-Z][A-Z0-9 .,&/-]{2,}$/;
export function kindOf(name, pn) {
  if (RE_MFG.test(pn || '')) return { label: '제조사품번', cls: 'b-gray' };
  const N = (name || '').toUpperCase();
  for (const [re, label, cls] of KIND) if (re.test(N)) return { label, cls };
  if (/^160/.test(pn)) return { label: '하네스', cls: 'b-pr' };
  if (/^110/.test(pn)) return { label: '어셈블리', cls: 'b-blue' };
  if (/^170/.test(pn)) return { label: '기구·판금', cls: 'b-green' };
  return { label: '부품', cls: 'b-gray' };
}

export const DISP = {
  UAI: ['UAI', '있는 그대로 사용', 'b-green'],
  NEW: ['NEW', '신규', 'b-blue'],
  NONE: ['NONE', '해당 없음', 'b-gray'],
  REWORK: ['REWORK', '재작업', 'b-amber'],
  SCRAP: ['SCRAP', '폐기', 'b-red'],
  RTV: ['RTV', '반품', 'b-red'],
};
export const TYPE_KO = { REL: '양산', NEW: '신규', DIS: '단종', OBS: '폐지', PRE: '시작' };

/* CHANGE COMMENTS 에서 교체 관계 자동 추출 */
const RE_REPL = [
  /P\/[nN]\s*([0-9][\w.-]{3,})\s+is\s+discontinued\s+and\s+replace[d]?\s+(?:by|with)\s+(?:P\/[nN]\s*)?([0-9][\w.-]{3,})/gi,
  /([0-9][\w.-]{5,})\s+(?:is\s+)?discontinued\s+and\s+replace[d]?\s+(?:by|with)\s+(?:P\/[nN]\s*)?([0-9][\w.-]{3,})/gi,
  /Replace[d]?\s+(?:PS1\s+)?(?:P\/[nN]\s*)?([0-9][\w.-]{5,})\s+with\s+(?:new\s+)?(?:P\/[nN]\s*)?([0-9][\w.-]{3,})/gi,
];
export function pullRepl(cn) {
  const out = new Map();
  const scan = (text, src) => {
    if (!text) return;
    RE_REPL.forEach(re => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) {
        const a = m[1].replace(/\.$/, ''), b = m[2].replace(/\.$/, '');
        if (a === b) continue;
        const k = a + '>' + b;
        if (!out.has(k)) out.set(k, { from: a, to: b, src });
      }
    });
  };
  scan(cn.reason, 'CN 사유'); scan(cn.solution, 'CN 해결');
  cn.parts.forEach(p => scan(p.comments, p.partNo));
  return [...out.values()];
}

export function derive(cn) {
  const d = {};
  d.bom = cn.bomAll;
  d.add = d.bom.filter(b => b.act === 'ADD');
  d.chg = d.bom.filter(b => b.act === 'CHG');
  d.del = d.bom.filter(b => b.act === 'DEL');

  /* 신규 릴리즈 품번 (FROM REV '-' 또는 FROM TYPE NEW) */
  const nm = new Map();
  d.add.forEach(b => {
    const isNew = b.fromType === 'NEW' || b.fromRev === '-' || b.fromRev === '';
    if (!isNew) return;
    const e = nm.get(b.pn) || { pn: b.pn, name: b.name, rev: b.toRev, assy: new Set(), qty: b.toQty, begin: b.begin };
    e.assy.add(b.assy); nm.set(b.pn, e);
  });
  d.newParts = [...nm.values()].map(x => ({ ...x, assy: [...x.assy] })).sort((a, b) => a.pn.localeCompare(b.pn));

  /* 기존 품번인데 새로 투입 */
  const am = new Map();
  d.add.forEach(b => {
    const isNew = b.fromType === 'NEW' || b.fromRev === '-' || b.fromRev === '';
    if (isNew) return;
    const e = am.get(b.pn) || { pn: b.pn, name: b.name, rev: b.fromRev, assy: new Set(), qty: b.toQty, begin: b.begin };
    e.assy.add(b.assy); am.set(b.pn, e);
  });
  d.addExist = [...am.values()].map(x => ({ ...x, assy: [...x.assy] })).sort((a, b) => a.pn.localeCompare(b.pn));

  /* 삭제 — 단종(DIS/OBS) 과 단순 제외 구분 */
  const dm = new Map();
  d.del.forEach(b => {
    const e = dm.get(b.pn) || { pn: b.pn, name: b.name, toType: b.toType, assy: new Set(), begin: b.begin };
    if (b.toType) e.toType = b.toType;
    e.assy.add(b.assy); dm.set(b.pn, e);
  });
  d.delParts = [...dm.values()].map(x => ({ ...x, assy: [...x.assy] })).sort((a, b) => a.pn.localeCompare(b.pn));
  d.eol = d.delParts.filter(x => /DIS|OBS/.test(x.toType));

  /* 수량 변경 */
  d.qty = d.chg.filter(b => String(b.fromQty) !== String(b.toQty));

  /* 상위 사용처 */
  const wu = new Map();
  cn.parts.forEach(p => (p.sections.whereUsed || []).forEach(w => {
    const e = wu.get(w.pn) || { pn: w.pn, name: w.name, from: new Set() };
    e.from.add(p.partNo); wu.set(w.pn, e);
  }));
  d.whereUsed = [...wu.values()].map(x => ({ ...x, from: [...x.from] }))
    .sort((a, b) => b.from.length - a.from.length || a.pn.localeCompare(b.pn));

  /* 적용 시점 */
  const dates = d.bom.map(b => usDate(b.begin).replace('~', '')).filter(Boolean).sort();
  d.dateFrom = dates[0] || ''; d.dateTo = dates[dates.length - 1] || '';

  d.partSet = new Set(cn.parts.map(x => x.partNo));
  d.repl = pullRepl(cn);

  /* 품목별 BOM 건수 */
  const cnt = new Map();
  d.bom.forEach(b => {
    const e = cnt.get(b.assy) || { ADD: 0, CHG: 0, DEL: 0 };
    e[b.act] = (e[b.act] || 0) + 1; cnt.set(b.assy, e);
  });
  cn.parts.forEach(p => {
    p.bomCnt = cnt.get(p.partNo) || { ADD: 0, CHG: 0, DEL: 0 };
    p.kind = kindOf(p.toDesc || p.fromDesc, p.partNo);
    p.revChanged = (p.fromRev || '') !== (p.toRev || '');
  });
  return d;
}

export const KO_SENT = [
  [/^Redline markups? from REV (\w+) (?:is|are) implemented in CAD at REV (\w+)\.?$/i, 'REV $1 레드라인 마크업을 CAD 에 반영하여 REV $2 로 개정'],
  [/^Additional updates? apart from Redline markups? from Rev (\w+)\.?$/i, 'Rev $1 레드라인 외 추가 변경 포함'],
  [/^Updated the PD as per new PD guideline (\d+)\.?\s*with respect to that,?\s*updated below changes\.?$/i, '신규 PD 지침 $1 에 맞춰 PD 갱신 — 아래와 같이 변경'],
  [/^(?:S|s)heet\s*(\d+)\s*[Cc]hanges?\s*:?$/i, '▣ Sheet $1 변경'],
  [/^Added\s+[Ss]heet\s*(\d+)\s+to show\s+(.+?):?$/i, '▣ Sheet $1 신설 — $2'],
];
const KO_VERB = [
  [/^Replaced?\s+(.*?)\s+with\s+(?:new\s+)?(.*)$/i, '교체: $1 → $2'],
  [/^Added\s+/i, '추가: '], [/^Add\s+/i, '추가: '],
  [/^Removed\s+/i, '삭제: '], [/^Remove\s+/i, '삭제: '],
  [/^Deleted\s+/i, '삭제: '], [/^Delete\s+/i, '삭제: '],
  [/^Updated\s+/i, '수정: '], [/^Update\s+/i, '수정: '],
  [/^Moved\s+/i, '이동: '], [/^Relocated\s+/i, '재배치: '],
];
const KO_WORD = [
  [/is discontinued and replaced? (?:by|with)/gi, '단종 → 대체품'],
  [/discontinued and replaced? (?:by|with)/gi, '단종 → 대체품'],
  [/and updated BOM accordingly/gi, '· BOM 반영'],
  [/Updated Reference document section to add the/gi, '참조문서 추가:'],
  [/Updated Ref Doc section to add/gi, '참조문서 추가:'],
  [/to show harness part number and label installed in backside of the door/gi, '도어 뒷면 하네스 품번·라벨 표시용'],
  [/since cable part numbers are shown in drawing/gi, '(케이블 품번이 도면에 표시되므로)'],
  [/Loading, heat dissipation and SCCR document/gi, '하중·방열·SCCR 문서'],
  [/to add Grounding PEM stud/gi, '(접지 PEM 스터드 추가 목적)'],
  [/grounding stud hardware/gi, '접지 스터드 체결자재'],
  [/to separate Fuse and TB/gi, '(퓨즈-단자대 분리 목적)'],
  [/for cable connection/gi, '(케이블 연결용)'],
  [/for more clearance/gi, '(여유 확보 목적)'],
  [/Minimum lighting level/gi, '최소 조도'],
  [/NOTICE WIRE COLOR SPEC/gi, '전선 색상 규격 안내'],
  [/REFERENCE DESIGNATOR|REF DESIGNATION/gi, 'REF 지정'],
  [/Flyback diode assembly/gi, '플라이백 다이오드 어셈블리'],
  [/Terminal block cover/gi, '단자대 커버'],
  [/din rail stopper|DIN RAIL STOPPER/gi, 'DIN 레일 스토퍼'],
  [/Fuse holder/gi, '퓨즈홀더'],
  [/power ?supply/gi, '파워서플라이'],
  [/Ground Label/gi, '접지 라벨'],
  [/Panel LEB/gi, '패널 LEB'],
  [/to mount CB1/gi, '(CB1 체결용)'],
  [/as per latest tolerance standard/gi, '최신 공차 표준에 따라'],
  [/as per latest standards?/gi, '최신 표준에 따라'],
  [/as per cabling standard/gi, '케이블 표준에 따라'],
  [/as per PD guideline/gi, 'PD 지침에 따라'],
  [/moved from sheet (\d+) to (?:new )?sheet (\d+)/gi, 'sheet $1 → sheet $2 이동'],
  [/relocated at [Zz]one ([A-H]\d)/g, '$1 구역으로 재배치'],
  [/\bat [Zz]one ([A-H]\d(?:\s*(?:,|and|to)\s*[A-H]\d)*)/g, '($1 구역)'],
  [/\bwith\s+(?:see|SEE)\s+(?:note|NOTE)\s*(\d+)/g, '— note $1 참조'],
  [/\b(?:see|SEE)\s+note\s*(\d+)\s+callout/gi, 'note $1 표기'],
  [/\b(?:is|are)\s+(?:callout|called out)/gi, '표기'],
  [/\bcallouts?\b/gi, '표기'],
  [/\bof qty\s*(\d+)/gi, '수량 $1'],
  [/\bqty\s*(\d+)/gi, '수량 $1'],
  [/\((\d+)\s*(?:PL|pl|Pl)\)/g, '($1개소)'],
  [/\b(\d+)\s*(?:PL|pl)\b/g, '$1개소'],
  [/\bsection view ([A-Z]-[A-Z])/gi, '$1 단면도'],
  [/\bsection arrow ([A-Z])\b/gi, '$1 단면 화살표'],
  [/\bview ([A-Z]-[A-Z])/g, '$1 단면도'],
  [/\bmissed\b|\bmissing\b/gi, '누락된'],
  [/\bRemoved\b|\bremove\b/gi, '삭제'],
  [/\bAdded\b|\badded\b/gi, '추가'],
  [/\bLabel\b|\bLABEL\b|\blabel\b/g, '라벨'],
  [/\bnote (\d+)/gi, 'note $1'],
  [/\bP\/[NnÑ]\s*/g, ''], [/\bp\/n\s*/g, ''],
  [/\bhardwares?\b/gi, '체결자재'],
  [/\bscrews?\b|\bSCR\b/gi, '스크류'],
  [/\bsince\b/gi, '사유:'],
  [/\s{2,}/g, ' '],
];
export function toKo(line) {
  let t = String(line || '').trim().replace(/^[-•]\s*/, '');
  if (!t) return '';
  for (const [re, out] of KO_SENT) if (re.test(t)) return t.replace(re, out);
  for (const [re, out] of KO_VERB) if (re.test(t)) { t = t.replace(re, out); break; }
  for (const [re, out] of KO_WORD) t = t.replace(re, out);
  return t.replace(/\s+\./g, '.').replace(/\.(?=[^\s.])/g, '. ').replace(/\s{2,}/g, ' ').trim();
}
const NAME_KO = [
  [/^ASSY PWR DISTR/, 'PD(배전반) 어셈블리'], [/FLYBACK DIODE/, '플라이백 다이오드 어셈블리'],
  [/^HARN.*\bDC\b/, 'DC 하네스'], [/^HARN.*\bAC\b/, 'AC 하네스'], [/^HARN/, '하네스'],
  [/^BRKT MOUNTING/, '마운팅 브라켓'], [/^BRKT RAISER/, '라이저 브라켓'], [/^BRKT/, '브라켓'],
  [/^CHAS RISER/, '샤시 라이저'], [/^PNL/, '패널'], [/^PLATE CPVC/, 'CPVC 플레이트'],
  [/^RAIL DIN/, 'DIN 레일'], [/^DIN RAIL STOPPER/, 'DIN 레일 스토퍼'],
  [/^LBL|^LABEL/, '라벨'], [/^SCR /, '스크류'],
  [/^WASHER FLAT/, '평와셔'], [/^WASHER LK SPLIT/, '스프링와셔'], [/^WASHER/, '와셔'],
  [/^NUT HEX/, '육각너트'], [/^POWER SUPPLY/, '파워서플라이'], [/^LVPS/, '저전압 파워서플라이'],
  [/^FUSE HOLDER/, '퓨즈홀더'], [/^TERM BLOCK COVER/, '단자대 커버'],
  [/^CONN LUG/, '커넥터 러그'], [/^CONN/, '커넥터'], [/^TERMINAL/, '터미널'],
  [/^WIRE/, '전선'], [/^DIODE/, '다이오드'], [/^HDL LOCKOUT/, '핸들 잠금장치'],
  [/^FERRULE/, '페룰 단자'], [/EYE CAP/, '아이캡'],
  [/^SPEC LOADING/, '하중 규격서'], [/^SPEC HEAT DISSIPATION/, '방열 규격서'],
  [/^ENG INFO SCCR/, 'SCCR 해석자료'], [/^SPEC/, '규격서'], [/^SCHEM/, '회로도'],
];
export function koName(n) {
  const N = String(n || '').toUpperCase();
  for (const [re, out] of NAME_KO) if (re.test(N)) return out;
  return '';
}

export function decodeCN(buf) {
  let s = new TextDecoder('utf-8').decode(buf);
  if (s.indexOf('\uFFFD') >= 0 && !/[가-힣]/.test(s)) {
    try { s = new TextDecoder('windows-1252').decode(buf); } catch (e) { }
  }
  return s;
}

/* =========================================================
   포털용 추가 — 품번 하나에 걸린 변경 · 하위 전개 · 목록 요약
   ========================================================= */
// 이 품번에 걸린 BOM 변경 (원래 도구의 repData)
export function repData(cn, d, pn) {
  const p = cn.parts.find(x => x.partNo === pn);
  if (!p) return null;
  const bom = d.bom.filter(b => b.assy === pn);
  const add = bom.filter(b => b.act === 'ADD');
  const chg = bom.filter(b => b.act === 'CHG');
  const del = bom.filter(b => b.act === 'DEL');
  const addSet = new Set(add.map(b => b.pn)), delSet = new Set(del.map(b => b.pn));
  const repl = d.repl.filter(r => delSet.has(r.from) || addSet.has(r.to));
  const begins = bom.map(b => usDate(b.begin).replace('~', '')).filter(Boolean).sort();
  return { p, bom, add, chg, del, repl, addSet, delSet, effFrom: begins[0] || '', effTo: begins[begins.length - 1] || '' };
}

// 하위 전개 — 이 품번 BOM 에 걸린 품목 중 이 CN 에서 자체 변경건이 따로 있는 것 (재귀)
export function subTree(cn, d, pn, depth = 1, seen = new Set([pn]), out = []) {
  d.bom.filter(b => b.assy === pn).forEach(b => {
    if (!d.partSet.has(b.pn) || seen.has(b.pn)) return;
    seen.add(b.pn);
    const sp = cn.parts.find(x => x.partNo === b.pn);
    const own = d.bom.filter(z => z.assy === b.pn);
    out.push({ depth, act: b.act, pn: b.pn, name: b.name, p: sp, own });
    if (own.length) subTree(cn, d, b.pn, depth + 1, seen, out);
  });
  return out;
}

// 목록에 보일 요약 — 저장할 때 한 번 계산해 summary 칸에 넣는다
export function summarize(cn, d) {
  const c = { ADD: d.add.length, CHG: d.chg.length, DEL: d.del.length };
  return {
    parts: cn.parts.length, bom: cn.totalBom ?? d.bom.length, add: c.ADD, chg: c.CHG, del: c.DEL,
    newPns: d.newParts.map(x => x.pn), eolPns: d.eol.map(x => x.pn),
    partNos: cn.parts.map(p => p.partNo),
  };
}

// 검색용 글자 — CN 번호 · 제목 · 변경 품목 · BOM 품번/품명
export function searchText(cn) {
  const s = new Set([cn.number, cn.title]);
  cn.parts.forEach(p => { s.add(p.partNo); s.add(p.fromDesc); s.add(p.toDesc); });
  (cn.bomAll || []).forEach(b => { s.add(b.pn); s.add(b.name); });
  return [...s].filter(Boolean).join(' | ').slice(0, 60000);
}

// 날짜 칸 (yyyy-mm-dd) — 적용 시점 최소 · 최대
export function cnDates(d) { return { from: d.dateFrom || null, to: d.dateTo || null }; }
