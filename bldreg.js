// 건축물대장 자동 조회 (주소 -> 법정동코드 변환 후 국토교통부 건축물대장정보 서비스 조회)
// 필요한 API 키 2개 (모두 무료, 본인 명의 발급 필요):
//  1) 행정안전부 도로명주소 API (juso.go.kr) - 주소 -> 법정동코드/지번 변환용
//  2) 공공데이터포털(data.go.kr) 건축물대장정보 서비스(국토교통부) - 실제 대장 조회용
const BldReg = (() => {
  const KEY = "fireInspectionApiKeys";
  // 외부(GitHub Pages) 접속 시 매번 재입력하지 않도록 기본값으로 내장 - 공개 저장소이므로 키가 노출됨을 인지하고 사용자가 직접 요청함.
  // juso.go.kr 키는 2026-08-11 발급된 임시(테스트) 키(devU01...)가 8일 만에 만료되어(E0014) 2026-08-19
  // "운영" 용도 정식 승인키로 재발급받아 교체함 - 임시 키와 달리 만료 걱정 없이 계속 써도 됨.
  const DEFAULT_KEYS = {
    jusoKey: "U01TX0FVVEgyMDI2MDgxOTE5MjQyMDEyMDAzNjA=",
    dataGoKrKey: "CxvoWctkbRsFSxR8Z%2Bpx876r5%2B07L4UY5%2F2VNLFt%2B01QBQwSjGcVqWe1onEs7H06tFLMp3tgh06U%2BZT0hFhNtw%3D%3D"
  };

  function getKeys() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      stored = {};
    }
    return {
      jusoKey: stored.jusoKey || DEFAULT_KEYS.jusoKey,
      dataGoKrKey: stored.dataGoKrKey || DEFAULT_KEYS.dataGoKrKey
    };
  }

  function saveKeys(keys) {
    localStorage.setItem(KEY, JSON.stringify(keys));
  }

  async function lookupAddress(address, jusoKey) {
    const params = new URLSearchParams({
      confmKey: jusoKey,
      currentPage: "1",
      countPerPage: "1",
      keyword: address,
      resultType: "json"
    });
    const res = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`);
    if (!res.ok) throw new Error("juso_http_" + res.status);
    const data = await res.json();
    const common = data.results && data.results.common;
    if (!common || common.errorCode !== "0") {
      throw new Error("juso_error: " + (common ? `${common.errorCode} ${common.errorMessage}` : "unknown"));
    }
    const juso = data.results.juso && data.results.juso[0];
    if (!juso) throw new Error("juso_not_found");
    return juso;
  }

  // 표제부(getBrTitleInfo)/총괄표제부(getBrRecapTitleInfo)는 요청 파라미터가 동일하므로 공통 처리.
  // 항상 원본 배열 그대로 반환 - 첫 항목만 필요한 호출부는 [0]을, 대지 내 모든 동이 필요한 호출부(층수/구조 집계)는 전체를 사용.
  async function queryBldRegOpList(operation, juso, dataGoKrKey, numOfRows) {
    const admCd = juso.admCd;
    const sigunguCd = admCd.slice(0, 5);
    const bjdongCd = admCd.slice(5, 10);
    const platGbCd = juso.mtYn === "1" ? "1" : "0";
    const bun = (juso.lnbrMnnm || "0").padStart(4, "0");
    const ji = (juso.lnbrSlno || "0").padStart(4, "0");
    // serviceKey는 data.go.kr에서 이미 URL-인코딩된 값으로 발급되므로 URLSearchParams로 다시 인코딩하면 깨진다 (재인코딩 방지 위해 별도로 붙임).
    const params = new URLSearchParams({
      sigunguCd, bjdongCd, platGbCd, bun, ji,
      _type: "json",
      numOfRows: String(numOfRows),
      pageNo: "1"
    });
    const res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/${operation}?serviceKey=${dataGoKrKey}&${params.toString()}`);
    if (!res.ok) throw new Error("bldreg_http_" + res.status);
    const data = await res.json();
    const header = data.response && data.response.header;
    if (!header || header.resultCode !== "00") {
      throw new Error("bldreg_error: " + (header ? `${header.resultCode} ${header.resultMsg}` : "unknown"));
    }
    const items = data.response.body && data.response.body.items;
    if (!items || items === "") return [];
    let item = items.item;
    if (!Array.isArray(item)) item = item ? [item] : [];
    return item;
  }

  // 지번 하나에 표제부가 여러 건 잡히는 경우가 있다 - 주건축물 외에 정화조/창고 같은 소규모
  // 부속건축물도 별도 항목으로 잡혀서, 무조건 배열 첫 항목(list[0])을 쓰면 부속건축물의 훨씬 작은
  // 연면적이 뜰 수 있다(사용자 리포트: "경상북도 고령군 대가야읍 낫질로 398"이 연면적 2.4㎡로 나옴 -
  // 실제로는 부속건축물(정화조 등) 2.4㎡와 주건축물 1420.4㎡ 두 항목이 있었고 부속건축물이 먼저
  // 반환됨, 2026-09-01). mainAtchGbCd "0"=주건축물, "1"=부속건축물이므로 주건축물을 우선한다.
  async function queryBldRegOp(operation, juso, dataGoKrKey) {
    const list = await queryBldRegOpList(operation, juso, dataGoKrKey, 20);
    if (!list.length) return null;
    return list.find((it) => it.mainAtchGbCd === "0") || list[0];
  }

  // 총괄표제부: 여러 동으로 이루어진 집합건축물(아파트 단지 등)에만 존재 - 없는 게 정상인 경우가 많음.
  async function getRecapTitleInfo(juso, dataGoKrKey) {
    return queryBldRegOp("getBrRecapTitleInfo", juso, dataGoKrKey);
  }

  // 표제부: 총괄표제부가 없는 일반건축물(단독주택, 상가 등) 및 집합건축물의 개별 동 정보 - 사실상 "일반건축물 정보"에 해당.
  async function getBuildingRegister(juso, dataGoKrKey) {
    return queryBldRegOp("getBrTitleInfo", juso, dataGoKrKey);
  }

  // 대지 내 모든 동의 표제부 목록 - 총괄표제부에는 없는 층수/구조를 동별로 집계하기 위함 (동이 많은 대단지 대비 넉넉히 100건).
  async function getBuildingRegisterList(juso, dataGoKrKey) {
    return queryBldRegOpList("getBrTitleInfo", juso, dataGoKrKey, 100);
  }

  // 여러 동의 표제부에서 층수(최고~최저)와 구조(중복 제거) 집계 - 총괄표제부는 대지 전체 집계값만 갖고
  // 동별 층수/구조는 갖지 않으므로, 그 값이 필요할 때만 이 집계를 사용한다.
  function summarizeFloorsAndStructure(items) {
    let grndMin = null, grndMax = null, ugrndMin = null, ugrndMax = null;
    const structures = [];
    for (const it of items) {
      const g = parseInt(it.grndFlrCnt, 10);
      if (!isNaN(g)) {
        grndMin = grndMin === null ? g : Math.min(grndMin, g);
        grndMax = grndMax === null ? g : Math.max(grndMax, g);
      }
      const u = parseInt(it.ugrndFlrCnt, 10);
      if (!isNaN(u)) {
        ugrndMin = ugrndMin === null ? u : Math.min(ugrndMin, u);
        ugrndMax = ugrndMax === null ? u : Math.max(ugrndMax, u);
      }
      const s = (it.strctCdNm || "").trim();
      if (s && !structures.includes(s)) structures.push(s);
    }
    return { grndMin, grndMax, ugrndMin, ugrndMax, structures };
  }

  // 층별개요: 표제부 한 동의 층별 구조/용도/면적 목록. 표제부 연면적(totArea)은 그 동 전체(아파트+상가
  // 등 혼합 용도) 합계이므로, 동의 주용도(mainPurpsCdNm)에 "아파트"가 섞여 있으면(주상복합) 표제부
  // 연면적만으로는 상가 부분 면적만 따로 뽑아낼 수 없다 - 층별개요를 층 단위로 조회해 용도별로 가른다.
  // numOfRows를 넉넉히 잡는 이유: 지번 하나에 동이 여러 개면 이 API가 대지 내 모든 동의 층별 레코드를
  // 한꺼번에 반환하므로(동 단위 필터 파라미터가 없음), 대단지(동 많고 층 많은 아파트)에서도 목표 동의
  // 층별 레코드가 잘리지 않도록 한다.
  async function getFloorOutlineList(juso, dataGoKrKey) {
    return queryBldRegOpList("getBrFlrOulnInfo", juso, dataGoKrKey, 1000);
  }

  // 상가 거래처의 연면적에서 아파트(공동주택) 부분을 제외하기 위한 용도 화이트리스트 - 이 목록에 없는
  // 용도(아파트/공동주택 등 주거용도 포함)는 합산에서 빠진다 (사용자 요청: 거래처가 상가인데 표제부
  // 연면적에 아파트 면적이 섞여 나오면 안 됨, 2026-09-03). 화이트리스트 방식이라 새 용도명이 나와도
  // 안전하게 동작(모르는 용도는 자동 제외될 뿐 잘못 포함되지는 않음).
  const SHOPPING_PURPOSE_KEYWORDS = ["상가", "판매시설", "근린생활시설", "교육연구시설", "의료시설", "운동시설"];
  function sumShoppingFloorArea(floorItems, dongNm) {
    let total = 0;
    const matchedFloors = [];
    for (const it of floorItems) {
      if (dongNm && (it.dongNm || "") !== dongNm) continue;
      const purps = (it.mainPurpsCdNm || "").trim();
      if (!purps || !SHOPPING_PURPOSE_KEYWORDS.some((kw) => purps.includes(kw))) continue;
      const area = parseFloat(it.area);
      if (isNaN(area)) continue;
      total += area;
      matchedFloors.push({ flrNoNm: it.flrNoNm || "", purps, area });
    }
    return { total, matchedFloors };
  }

  // 동의 주용도에 "아파트"가 포함된 경우(주상복합 등 - 한 동 안에 상가와 아파트가 섞여 있음)에만
  // 층별개요로 상가 관련 용도 면적만 다시 합산한다. "아파트"가 없으면(순수 상가 건물 등) 표제부
  // 연면적(totArea)을 그대로 쓴다 - 불필요한 API 호출과 화이트리스트 누락으로 인한 면적 축소를 피함.
  // 반환: null이면 override 없음(호출부가 item.totArea 그대로 사용).
  async function getShoppingAreaOverride(item, juso, dataGoKrKey) {
    if (!item || !(item.mainPurpsCdNm || "").includes("아파트")) return null;
    try {
      const floorItems = await getFloorOutlineList(juso, dataGoKrKey);
      const { total, matchedFloors } = sumShoppingFloorArea(floorItems, item.dongNm);
      if (!matchedFloors.length) return null;
      return { total, matchedFloors };
    } catch (e) {
      return null;
    }
  }

  // 거래처명이 "OO상가1"처럼 "상가" 뒤에 번호가 붙는 경우 - 표제부(대지 내 모든 동)에서 동명칭에
  // "상가"와 그 번호가 함께 들어간 동을 찾아, 그 동 하나의 주용도/연면적/층수를 그대로 가져온다
  // (여러 동을 합산하지 않음 - 사용자 요청). 번호가 포함된 동을 못 찾으면(동명칭에 번호 표기가
  // 없는 경우 등) "상가"만 포함된 동으로 넉넉하게 다시 찾는다.
  // 반환: item이 null이면 "상가"가 들어간 동 자체를 못 찾은 것 - 호출부가 처리.
  // shoppingArea: 동의 주용도에 아파트가 섞여 있어 층별개요로 상가 관련 용도만 재합산한 경우에만
  // 값이 있음(null이면 item.totArea를 그대로 쓰면 됨).
  async function lookupShoppingDong(address, number) {
    const keys = getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      const err = new Error("missing_keys");
      err.code = "missing_keys";
      throw err;
    }
    const juso = await lookupAddress(address, keys.jusoKey);
    const titleList = await getBuildingRegisterList(juso, keys.dataGoKrKey);
    const shoppingDongs = titleList.filter((it) => (it.dongNm || "").includes("상가"));
    let matched = shoppingDongs;
    if (number) {
      const numMatched = shoppingDongs.filter((it) => (it.dongNm || "").includes(number));
      if (numMatched.length) matched = numMatched;
    }
    // 아파트 단지의 상가 동은 동명칭이 다른 동과 똑같이 숫자뿐이고("301동") 주용도만 다른 경우가
    // 흔하다(사용자 리포트: "대구광역시 달서구 진천로 77" 진천역 계룡 리슈빌 - 상가 동명칭이
    // "301동"이라 이름 매칭으로는 찾지 못했음, 2026-09-03). 동명칭 매칭이 하나도 없으면 주용도
    // (SHOPPING_PURPOSE_KEYWORDS - 상가/판매시설/근린생활시설 등)로 폴백해서 찾는다. 이 경우
    // 번호("상가1" 등)는 동명칭 표기 관례를 전제로 하므로 적용하지 않는다.
    let matchedByPurpose = false;
    if (!matched.length) {
      matched = titleList.filter((it) => SHOPPING_PURPOSE_KEYWORDS.some((kw) => (it.mainPurpsCdNm || "").includes(kw)));
      matchedByPurpose = matched.length > 0;
    }
    const item = matched[0] || null;
    const shoppingArea = await getShoppingAreaOverride(item, juso, keys.dataGoKrKey);
    return {
      juso,
      item,
      shoppingArea,
      matchedByPurpose,
      dongCandidates: shoppingDongs.map((it) => it.dongNm).filter(Boolean)
    };
  }

  // 반환: { juso, item, source, floorSummary } / item이 null이면 대장을 찾지 못함. source: "recap"(총괄표제부) | "title"(표제부/일반건축물)
  // floorSummary: item 자체에 층수/구조 정보가 없을 때(주로 총괄표제부인 경우)만 대지 내 모든 동의 표제부를 조회해 채운 값. 없으면 null.
  async function lookup(address) {
    const keys = getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      const err = new Error("missing_keys");
      err.code = "missing_keys";
      throw err;
    }
    const juso = await lookupAddress(address, keys.jusoKey);
    let item = null;
    let source = null;
    try {
      item = await getRecapTitleInfo(juso, keys.dataGoKrKey);
      if (item) source = "recap";
    } catch (e) {
      // 총괄표제부가 없는 건물(대부분의 일반건축물)은 이 API가 정상적으로 에러 응답을 주므로 무시하고 표제부로 폴백.
    }
    if (!item) {
      item = await getBuildingRegister(juso, keys.dataGoKrKey);
      if (item) source = "title";
    }
    let floorSummary = null;
    if (item && (!(item.grndFlrCnt || item.ugrndFlrCnt) || !item.strctCdNm)) {
      try {
        const titleItems = await getBuildingRegisterList(juso, keys.dataGoKrKey);
        floorSummary = summarizeFloorsAndStructure(titleItems);
      } catch (e) {
        // 동별 표제부 목록 조회가 실패해도 이미 얻은 item(연면적 등)은 그대로 유지 - 층수/구조만 비어있게 된다.
      }
    }
    return { juso, item, source, floorSummary };
  }

  return { getKeys, saveKeys, lookup, lookupShoppingDong };
})();
