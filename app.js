// 소방점검 관리 앱 메인 로직
(() => {
  let editingSiteId = null;
  let currentSiteId = null;      // 현장 상세 화면에서 보고 있는 현장
  let currentInspectionId = null; // 점검 상세/사진 갤러리 화면에서 보고 있는 점검 회차(날짜)
  let selectedInspectionDate = null; // 거래처 상세의 "점검하기" 버튼이 사용할 날짜 - 기본 오늘, 사용자가 수정 가능
  let currentConstructionSiteId = null;  // 공사팀에서 보고 있는 업체(=현장)
  let activeObjectUrls = [];
  let pendingAttachments = [];   // 신규 현장 등록 시 아직 저장 전인 첨부파일 (저장 시점에 실제 siteId로 옮겨 담음)
  let sitesSortMode = "name";    // "name"(가나다순) | "region"(지역별) - 거래처 목록 정렬 방식
  let sitesSelectedRegion = null; // 지역별 모드에서 드릴다운한 지역 (구/도 이름), null이면 지역 버튼 목록 표시 중
  // "이번달" 필터 - 정렬 방식과 별개로 켜고 끌 수 있는 토글. "거래처 관리"(등록 화면 아래 목록)와
  // "점검팀"(거래처 목록) 두 화면이 이 상태를 공유한다 - 같은 거래처 목록을 보여주는 화면이라서.
  let sitesMonthOnly = false;
  let defSortMode = "name";      // 지적사항 허브(업체별) 정렬 방식: "name"(가나다순) | "region"(지역별) | "recent"(최신순 - 점검완료일 기준)
  let defSelectedRegion = null;
  let defFilters = new Set();    // 지적사항 허브 상태 필터: "pending"|"none"|"open"|"resolved" 중 선택된 것들 (OR 조건)
  // "이번달"/"다음달"/"지난달" 버튼 - 종합/작동점검월이 그 달에 해당하는 거래처만 보여준다(사용자
  // 요청). 셋 중 하나만 켤 수 있고(null이면 전체), 켜는 순간 그에 맞는 정렬로 강제 전환한다
  // (이번달→최신순, 다음달/지난달→가나다순) - 지역별 정렬과는 동시에 쓰지 않는다.
  let defMonthFilter = null;     // null | "this" | "next" | "last"
  let comprehensiveTarget = null; // 현장 등록/수정 폼의 "종합점검대상/해당없음" 토글 상태: true | false | null(미정)
  // 종합점검/작동점검월을 예외적으로 직접 지정한 값 - null이면 자동계산(comprehensiveTarget+사용승인일) 사용,
  // 숫자(1~12)면 저장 시 site.comprehensiveMonthOverride/operationalMonthOverride로 저장되어 항상 우선한다.
  let comprehensiveMonthValue = null;
  let operationalMonthValue = null;
  let scheduleCalDate = new Date();   // 스케줄 관리 달력이 보여주는 월
  let scheduleSelectedDate = "";      // 스케줄 관리에서 선택된 날짜 (YYYY-MM-DD)
  let scheduleCompanySearchTerm = ""; // 스케줄 관리 업체 선택 목록 검색어
  let scheduleStagedIds = new Set();  // 업체 선택 화면에서 "확인"을 누르기 전까지 임시로 체크된 업체 (저장 전)
  // 업체 선택 목록 전용 정렬/필터 상태 - "거래처 관리"/"점검팀" 화면의 sitesSortMode와는 별개로 둔다
  // (날짜별로 업체를 고르는 일시적인 작업이라, 여기서 지역별을 골랐다고 다른 화면까지 바뀌면 오히려 헷갈림).
  let schedulePickSortMode = "name";      // "name"(가나다순) | "region"(지역별)
  let schedulePickSelectedRegion = null;
  let schedulePickMonthOnly = false;      // "이번달" 필터

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  // 이 프로젝트는 번들러를 쓰지 않아 @capacitor/core 전체가 아니라 가벼운 native-bridge.js만 로드된다
  // (window.Capacitor.registerPlugin은 없다) - 대신 native-bridge.js가 실제로 제공하는 저수준
  // nativePromise(pluginName, methodName, options)로 아무 네이티브 플러그인이나 직접 호출한다.
  function callNativePlugin(pluginName, method, options) {
    return window.Capacitor.nativePromise(pluginName, method, options);
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result; // "data:<mime>;base64,XXXX"
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // 네이티브 앱(APK) 안의 WebView는 Web Share API(navigator.share)를 지원하지 않는 경우가 많아
  // "공유" 버튼을 눌러도 아무 앱 선택 화면 없이 조용히 실패하거나 다운로드로만 대체됐다 - 안드로이드의
  // 진짜 공유 시트(어느 앱으로 보낼지 아이콘이 뜨는 화면)를 확실히 띄우려면 @capacitor/filesystem으로
  // 파일을 앱 캐시에 저장한 뒤 그 파일의 uri를 넘겨야 한다.
  // 처음엔 @capacitor/share의 share()를 썼는데, 그 플러그인은 MIME 타입을 파일 확장자로 추측한다
  // (MimeTypeMap.getMimeTypeFromExtension) - 안드로이드는 .hwpx 같은 비표준 확장자를 몰라서 항상
  // "*/*"로 넘어가고, 카카오톡 등 일부 앱은 그렇게 애매한 타입으로 온 첨부를 사용자가 골라도 조용히
  // 전송하지 않는다(실제 사용자가 겪은 문제: "카카오톡으로 전송이 안됨"). 그래서 확장자 추측에 기대지
  // 않고 우리가 이미 알고 있는 정확한 MIME 타입을 직접 넘기는 자체 FileSaver.shareFiles를 쓴다.
  async function nativeShareFiles(blobsWithNames, title) {
    const uris = [];
    for (const { blob, name } of blobsWithNames) {
      const base64 = await blobToBase64(blob);
      const result = await callNativePlugin("Filesystem", "writeFile", {
        path: name,
        data: base64,
        directory: "CACHE",
        recursive: true,
      });
      uris.push(result.uri);
    }
    const mimeType = (blobsWithNames[0] && blobsWithNames[0].blob.type) || "*/*";
    await callNativePlugin("FileSaver", "shareFiles", {
      uris,
      mimeType,
      title,
      dialogTitle: "공유할 앱을 선택하세요",
    });
  }
  // "다운로드한 파일이 어디에 저장되는지 모르겠다"는 요청으로 추가 - 공유 화면과 달리 이건 다른 앱으로
  // 넘기지 않고, 안드로이드 표준 "다운로드" 폴더(파일 관리자 앱에서 바로 보이는 곳)에 직접 저장하고
  // 그 위치를 그대로 돌려준다. 네이티브 FileSaver 플러그인(이 프로젝트가 직접 만든 것, android/app/src/
  // main/java/.../FileSaver.java) 사용.
  async function nativeSaveToDownloads(blob, filename, mimeType) {
    const base64 = await blobToBase64(blob);
    // { location, uri, mimeType } - uri는 저장 직후 "어떤 프로그램으로 열지" 선택 화면을 띄우는 데 쓴다.
    return callNativePlugin("FileSaver", "saveToDownloads", {
      filename,
      data: base64,
      mimeType,
    });
  }
  // 저장된 파일이 실제로 정상 파일인지, 한글 등 원하는 프로그램에서 잘 열리는지 그 자리에서 바로
  // 확인할 수 있도록 안드로이드의 "다음으로 열기" 앱 선택 화면을 띄운다. 열 수 있는 앱이 없어도
  // (예: 한글 앱 미설치) 조용히 무시한다 - 파일은 이미 다운로드 폴더에 저장되어 있으므로 실패로 볼 일은 아니다.
  async function nativeOfferToOpen(uri, mimeType) {
    try {
      await callNativePlugin("FileSaver", "openFile", { uri, mimeType });
    } catch (e) {
      // 열 앱이 없는 경우 등 - 파일 저장 자체는 이미 성공했으므로 조용히 넘어간다.
    }
  }

  // 업로드/생성되는 파일을 구글 드라이브(사장님 계정, 중앙 백업 프록시)에 저장 - 꺼져 있거나
  // 실패해도 절대 호출부의 저장/UI 흐름을 막지 않는다(항상 조용히 무시, throw하지 않음).
  // 반환하는 프로미스는 uploadToSite의 결과를 그대로 넘기므로(꺼져있거나 실패하면 null),
  // 완료를 기다리고 싶은 호출부(await backupToDrive(...))나 실패를 사용자에게 알려야 하는 곳
  // (예: 지적사항 사진)에서 쓸 수 있고, 정말 기다릴 필요 없는 곳은 그냥 호출만 하고 무시해도 안전하다.
  function backupToDrive(siteId, category, filename, blob) {
    if (!blob) return Promise.resolve(null);
    return (siteId ? FireDB.getSite(siteId) : Promise.resolve(null))
      .then((site) => DriveBackup.uploadToSite(site ? site.name : null, category, filename, blob))
      .catch(() => null);
  }

  // 사진은 기기별 IndexedDB에만 저장된다 - 다른 사용자/기기(예: 휴대폰으로 찍어 올린 사진)에서 올린
  // 것은 이 기기 로컬 저장소엔 원본이 없어 photoMap에 빠질 수 있다(실제 사용자가 겪은 문제: "지적사항
  // 클릭해서 들어가면 다른 사람이 올린 사진이 안 보임"). 이미 구글 드라이브에 자동 백업된 사본이
  // 있으면 그걸로 photoMap을 채운다 - 파일명 규칙은 backupToDrive가 지적사항 사진을 올릴 때 쓰는 것과
  // 동일(이행전_<id>.jpg / 이행후_<id>.jpg). 이행완료보고서 생성(openCompletionReport)에서만 쓰던
  // 로직인데, 지적사항 목록 화면(renderDeficiencies)의 사진 썸네일에도 똑같이 필요해서 공용 함수로
  // 뺐다 - 찾은 사진은 로컬에도 저장해둬서(FireDB.addPhoto, 기존 id 그대로) 다음부터는 다시 내려받지
  // 않고 오프라인에서도 보이게 한다.
  async function fillMissingPhotosFromDrive(siteId, defs, photoMap) {
    const site = await FireDB.getSite(siteId);
    if (!site || !site.name) return;
    const missing = [];
    defs.forEach((def) => {
      (def.beforePhotoIds || []).forEach((id) => { if (!photoMap.has(id)) missing.push({ id, prefix: "이행전", role: "before", def }); });
      (def.afterPhotoIds || []).forEach((id) => { if (!photoMap.has(id)) missing.push({ id, prefix: "이행후", role: "after", def }); });
    });
    if (missing.length === 0) return;
    await Promise.all(missing.map(async ({ id, prefix, role, def }) => {
      const blob = await DriveBackup.fetchFile(site.name, "지적사항_사진", `${prefix}_${id}.jpg`);
      if (!blob) return;
      photoMap.set(id, { id, blob });
      FireDB.addPhoto({ id, siteId, itemId: def.id, role, blob, createdAt: new Date().toISOString() }).catch(() => {});
    }));
  }

  // 현장점검 사진 버전의 fillMissingPhotosFromDrive - 지적사항과 달리 현장점검 사진은 원래
  // 어떤 id들이 있어야 하는지 알 방법이 없었다(사진이 기기별 로컬에만 있고, 점검 회차 자체에는
  // "이 회차엔 사진이 몇 장 있다"는 목록이 없었음) - 그래서 업로드/삭제 시 점검 회차(inspections,
  // 공유 데이터)에 photoIds 목록을 같이 남겨두게 했다(이 파일의 업로드/삭제 핸들러 참고). 그
  // 목록을 기준으로 이 기기 로컬에 없는 사진만 구글 드라이브에서 찾아 채운다.
  // 주의: 이 기능을 추가하기 전에 이미 올라간 사진은 photoIds 목록이 없어 이 방식으로는 못 찾는다.
  async function fillMissingInspectionPhotosFromDrive(inspectionId, photoMap) {
    const insp = await FireDB.getInspection(inspectionId);
    if (!insp || !insp.photoIds || !insp.photoIds.length) return;
    const site = await FireDB.getSite(insp.siteId);
    if (!site || !site.name) return;
    const missing = insp.photoIds.filter((id) => !photoMap.has(id));
    if (missing.length === 0) return;
    await Promise.all(missing.map(async (id) => {
      const blob = await DriveBackup.fetchFile(site.name, "현장점검_사진", `${id}.jpg`);
      if (!blob) return;
      const photo = { id, siteId: insp.siteId, inspectionId, blob, createdAt: new Date().toISOString() };
      photoMap.set(id, photo);
      FireDB.addPhoto(photo).catch(() => {});
    }));
  }

  // 지적사항 이행전/이행후 사진을 모바일에서 올릴 때 너무 오래 걸린다는 사용자 리포트(2026-08-22) -
  // 원인은 압축 없이 폰 카메라 원본(보통 3000~4000px, 수 MB)을 그대로 IndexedDB에 저장하고 그대로
  // 구글 드라이브까지 업로드하고 있었기 때문(느린 건 로컬 저장이 아니라 모바일 회선으로 원본 전체를
  // 올리는 네트워크 구간). 화면/보고서 어디에도 원본 해상도가 필요 없으므로(hwpx-export.js도 최종
  // 인쇄용으로 훨씬 작은 해상도로 다시 인코딩해서 씀) 저장/업로드 전에 긴 변을 최대 1600px로 줄이고
  // JPEG 85%로 재인코딩한다. <img> 디코딩은 EXIF Orientation을 반영해서 그려주므로 회전 문제도 없다.
  // HEIC 등 디코딩 자체가 안 되는 파일은 원본을 그대로 쓴다(느리더라도 안 올리는 것보다 낫다).
  async function compressPhotoForUpload(file, maxDim, quality) {
    try {
      const url = URL.createObjectURL(file);
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      const { naturalWidth: w, naturalHeight: h } = image;
      const scale = Math.min(1, (maxDim || 1600) / Math.max(w, h));
      if (scale >= 1) { URL.revokeObjectURL(url); return file; }
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(image, 0, 0, targetW, targetH);
      URL.revokeObjectURL(url);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas_encode_failed"))), "image/jpeg", quality || 0.85);
      });
      return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
    } catch (e) {
      return file;
    }
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // "01031308364" 처럼 하이픈 없이 저장된 옛날 데이터도 화면에는 "010-3130-8364"처럼 보이도록 표시용으로 포맷.
  // 이미 하이픈이 있거나 형식을 알 수 없는 값은 원본 그대로 둔다(잘못 자르지 않기 위해).
  function formatPhone(raw) {
    const digits = (raw || "").replace(/[^0-9]/g, "");
    if (!digits) return raw || "";
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
    if (digits.length === 10) {
      return digits.startsWith("02")
        ? digits.replace(/(\d{2})(\d{4})(\d{4})/, "$1-$2-$3")
        : digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    }
    if (digits.length === 9 && digits.startsWith("02")) return digits.replace(/(\d{2})(\d{3})(\d{4})/, "$1-$2-$3");
    return raw || "";
  }

  // 점검번호는 "숫자-알파벳-세자리숫자"(예: "1-A-001") 형식 - 지적사항 하나가 점검표 항목 2개에 걸쳐있으면
  // 원본 표/AI 인식 과정에서 구분자 없이 그대로 붙어(예: "1-A-0012-B-002") 들어오는 경우가 있어, 그 안에서
  // 이 형식에 맞는 코드를 모두 찾아 쉼표로 이어붙인다. 코드가 하나뿐이거나 이 형식이 전혀 안 보이면
  // (예: 문서마다 다른 자체 번호 체계) 원본을 그대로 둔다 - 잘못 잘라내지 않기 위함.
  function normalizeInspectionCode(raw) {
    if (!raw) return raw || "";
    const matches = raw.match(/\d-[A-Za-z]-\d{3}/g);
    return matches && matches.length > 1 ? matches.join(", ") : raw;
  }

  // 탐색기/다른 폴더에서 파일을 끌어다 놓아도 기존 파일 선택(input[type=file]) 방식과 똑같이
  // 동작하도록 하는 공통 헬퍼 - dragover 중엔 el에 "drag-over" 클래스로 시각적 표시를 주고,
  // 놓인 파일 중 첫 번째만 onFile로 넘긴다(기존 파일 입력도 한 번에 한 개만 다뤘으므로 동일하게 맞춤).
  // dragenter/dragleave는 자식 요소를 넘나들 때마다도 반복 발생하므로 depth 카운터로 묶어서
  // 전체 영역을 벗어날 때만 표시를 지운다.
  function setupFileDropZone(el, onFile) {
    if (!el) return;
    let dragDepth = 0;
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    el.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) el.classList.remove("drag-over");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      el.classList.remove("drag-over");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    });
  }

  function revokeObjectUrls() {
    activeObjectUrls.forEach((u) => URL.revokeObjectURL(u));
    activeObjectUrls = [];
  }

  // ---------- 거래처 지역 분류 (가나다순/지역별 정렬용) ----------
  // 대구는 구/군 단위까지, 그 외 지역은 도/광역시 단위까지만 분류한다(사용자 요청).
  // "달서구"는 "서구"를 부분 문자열로 포함하므로 반드시 먼저 검사해야 오분류를 피할 수 있다.
  const DAEGU_DISTRICTS = ["달서구", "달성군", "군위군", "수성구", "동구", "서구", "남구", "북구", "중구"];
  const PROVINCE_PATTERNS = [
    [/^대구/, "대구"],
    [/^서울/, "서울"],
    [/^부산/, "부산"],
    [/^인천/, "인천"],
    [/^광주/, "광주"],
    [/^대전/, "대전"],
    [/^울산/, "울산"],
    [/^세종/, "세종"],
    [/^경기/, "경기"],
    [/^강원/, "강원"],
    [/^충청북|^충북/, "충북"],
    [/^충청남|^충남/, "충남"],
    [/^전라북|^전북/, "전북"],
    [/^전라남|^전남/, "전남"],
    [/^경상북|^경북/, "경북"],
    [/^경상남|^경남/, "경남"],
    [/^제주/, "제주"]
  ];
  function classifyRegion(address) {
    const addr = (address || "").trim();
    if (!addr) return "지역 미상";
    for (const [re, label] of PROVINCE_PATTERNS) {
      if (!re.test(addr)) continue;
      if (label === "대구") {
        const gu = DAEGU_DISTRICTS.find((g) => addr.includes(g));
        return gu || "대구 기타";
      }
      return label;
    }
    return "지역 미상";
  }
  // 요약줄의 "N개 지역" 개수용 - 버튼 그리드는 대구를 구/군까지 쪼개서 보여주지만,
  // 이 개수는 광역시/도 단위로만 세어 대구의 여러 구가 지역 개수를 부풀리지 않게 한다.
  function classifyBroadRegion(address) {
    const addr = (address || "").trim();
    if (!addr) return "지역 미상";
    for (const [re, label] of PROVINCE_PATTERNS) {
      if (re.test(addr)) return label;
    }
    return "지역 미상";
  }

  // 이행완료 보고서의 "○○ 소방본부장ㆍ소방서장 귀하"를 실제 관할소방서 이름으로 채우기 위한 최선 추정.
  // 정확한 관할 구역은 소방서마다 다르고 공식 API가 없어 완전히 보장할 수 없으므로, 확실히 아는 대구 구/군과
  // 창원(마산/창원/진해로 나뉨) 특례만 정확히 매핑하고, 나머지는 "OO시/군소방서" 일반 규칙으로 추정한다.
  // 현장 등록 화면의 "관할소방서" 칸은 직접 입력할 수 없는 읽기 전용 칸이라, 이 추정값이 곧 저장되는 값이다.
  const DAEGU_FIRE_STATION = {
    "중구": "중부소방서", "동구": "동부소방서", "서구": "서부소방서", "남구": "남부소방서",
    "북구": "북부소방서", "수성구": "수성소방서", "달서구": "달서소방서", "달성군": "달성소방서"
  };
  const CHANGWON_FIRE_STATION = {
    "마산합포구": "마산소방서", "마산회원구": "마산소방서",
    "성산구": "창원소방서", "의창구": "창원소방서",
    "진해구": "진해소방서"
  };
  function guessFireStation(address) {
    const addr = (address || "").trim();
    if (!addr) return "";
    if (/^대구/.test(addr)) {
      const gu = DAEGU_DISTRICTS.find((g) => addr.includes(g));
      return (gu && DAEGU_FIRE_STATION[gu]) || "";
    }
    if (addr.includes("창원시")) {
      const gu = Object.keys(CHANGWON_FIRE_STATION).find((g) => addr.includes(g));
      if (gu) return CHANGWON_FIRE_STATION[gu];
    }
    const tokens = addr.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i].replace(/[^가-힣]/g, "");
      if (/^[가-힣]{2,}(시|군)$/.test(t) && !/(특별시|광역시|특별자치시|특별자치도)$/.test(t)) {
        // 실제 소방서 명칭은 "OO시소방서"가 아니라 "시/군" 접미사를 뗀 "OO소방서" 형태이므로
        // (예: "경산시" -> "경산소방서", "경산시소방서" 아님) 여기서 접미사를 제거한다.
        return `${t.replace(/(시|군)$/, "")}소방서`;
      }
    }
    return "";
  }

  // 사용승인일 문자열에서 월(1~12)만 최대한 관대하게 뽑아낸다 - "YYYY-MM-DD", "YYYYMMDD", "YYYY.M.D",
  // "2013년 7월" 처럼 자유 입력/자동 인식 결과가 저마다 형식이 다를 수 있어서.
  function extractApprovalMonth(approvalDate) {
    const s = (approvalDate || "").trim();
    if (!s) return null;
    const m = s.match(/^\d{4}[.\-/](\d{1,2})[.\-/]\d{1,2}/) || s.match(/^\d{4}(\d{2})\d{2}$/) || s.match(/(\d{1,2})\s*월/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    return month >= 1 && month <= 12 ? month : null;
  }

  // 종합점검/작동점검 대상월 계산 - site.comprehensiveTarget이 true(스프링클러 등 설치, 종합점검 대상)면
  // 종합점검은 사용승인월, 작동점검은 그 6개월 뒤. false(해당없음)면 종합점검 없이 작동점검만 사용승인월.
  // comprehensiveTarget이 아직 정해지지 않았거나(null) 사용승인일을 알 수 없으면 자동계산은 못하지만,
  // site.comprehensiveMonthOverride/operationalMonthOverride(현장 정보 수정 화면에서 예외적으로 직접
  // 지정한 월)가 있으면 그 값이 항상 자동계산 결과보다 우선한다.
  function computeInspectionMonths(site) {
    const approvalMonth = extractApprovalMonth(site.approvalDate);
    let comprehensiveMonth = null;
    let operationalMonth = null;
    if (approvalMonth !== null && typeof site.comprehensiveTarget === "boolean") {
      if (site.comprehensiveTarget) {
        comprehensiveMonth = approvalMonth;
        operationalMonth = ((approvalMonth - 1 + 6) % 12) + 1;
      } else {
        operationalMonth = approvalMonth;
      }
    }
    if (typeof site.comprehensiveMonthOverride === "number") comprehensiveMonth = site.comprehensiveMonthOverride;
    if (typeof site.operationalMonthOverride === "number") operationalMonth = site.operationalMonthOverride;
    if (comprehensiveMonth === null && operationalMonth === null) return null;
    return { comprehensiveMonth, operationalMonth };
  }

  function inspectionScheduleBadgeHtml(site) {
    const sched = computeInspectionMonths(site);
    if (!sched) return "";
    const comp = sched.comprehensiveMonth ? `종합 ${sched.comprehensiveMonth}월` : "종합 해당없음";
    return `<span class="inspection-schedule-badge">${comp} · 작동 ${sched.operationalMonth}월</span>`;
  }

  // 점검 회차(날짜)가 작동점검인지 종합점검인지 - computeInspectionMonths로 구한 현장별
  // 종합/작동 대상월과 그 날짜의 월을 비교해서 판단한다. 대상월을 아직 모르면(사용승인일/종합점검대상
  // 미입력) 기본값인 작동점검으로 표시.
  function inspectionTypeForMonth(site, dateStr) {
    const sched = computeInspectionMonths(site);
    const month = parseInt((dateStr || todayISO()).slice(5, 7), 10);
    if (sched) {
      if (sched.comprehensiveMonth === month) return "종합점검";
      if (sched.operationalMonth === month) return "작동점검";
    }
    return "작동점검";
  }

  // 지정한 달(1~12)이 그 현장의 종합점검월 또는 작동점검월과 같으면 true - "이번달"/"다음달"/
  // "지난달" 필터가 모두 이 함수 하나로 동작한다(달 숫자만 다르게 넘김).
  function isSiteInMonth(site, month) {
    const sched = computeInspectionMonths(site);
    if (!sched) return false;
    return sched.comprehensiveMonth === month || sched.operationalMonth === month;
  }

  // "이번달" 필터 - 이번 달이 그 현장의 종합점검월 또는 작동점검월과 같으면 true.
  function isSiteInCurrentMonth(site) {
    return isSiteInMonth(site, new Date().getMonth() + 1);
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#" + id).classList.add("active");
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  }

  // 헤더의 "← 뒤로" 버튼은 화면마다 원래 있던 개별 뒤로가기 버튼을 그대로 대신 눌러준다 -
  // (그 버튼들이 이미 각 화면에 맞는 재조회/상태 정리를 다 하고 있으므로 로직을 중복시키지 않는다)
  // 매핑에 없는 화면(홈, 거래처보기/일정관리/설정/지적사항 허브 같은 최상위 탭 화면)은 홈으로 이동한다.
  const BACK_DELEGATE = {
    "screen-construction-team": "btnBackFromConstructionTeam",
    "screen-construction-company": "btnBackFromConstructionCompany",
    "screen-construction-estimates": "btnBackFromConstructionEstimates",
    "screen-construction-history": "btnBackFromConstructionHistory",
    "screen-construction-job-detail": "btnBackFromConstructionJobDetail",
    "screen-site-entry-choice": "btnCancelEntryChoice",
    "screen-site-form": "btnCancelSiteForm",
    "screen-site-detail": "btnBackToSites",
    "screen-inspection-detail": "btnBackFromInspectionDetail",
    "screen-deficiency-rounds": "btnBackFromRounds",
    "screen-deficiencies": "btnBackFromDeficiencies",
    "screen-completion-report": "btnBackFromCompletionReport"
  };

  // ---------- 홈 ----------
  const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

  // 날짜(캘린더 일자) 기준으로 연속되는 항목들을 그룹으로 묶는다 - 점검 이력/지적사항 회차
  // 목록 둘 다 "며칠 연속 방문"을 테두리 하나로 보여주는 데 같이 쓴다(사용자 요청, 종합/작동
  // 점검이 하루에 안 끝나고 2일 이상 걸리는 경우가 있어서). items는 이미 날짜 내림차순
  // 정렬되어 있어야 하고, dateOf(item)은 그 항목의 "YYYY-MM-DD" 날짜 문자열을 반환해야 한다.
  function groupConsecutiveByDate(items, dateOf) {
    const groups = [];
    let current = [];
    items.forEach((item) => {
      const prev = current[current.length - 1];
      const prevDateStr = prev ? dateOf(prev) : null;
      const curDateStr = dateOf(item);
      const prevD = prevDateStr ? new Date(prevDateStr + "T00:00:00") : null;
      const curD = curDateStr ? new Date(curDateStr + "T00:00:00") : null;
      const isConsecutive = prevD && curD && !isNaN(prevD) && !isNaN(curD) && (prevD - curD) === 86400000;
      if (!isConsecutive && current.length > 0) { groups.push(current); current = []; }
      current.push(item);
    });
    if (current.length > 0) groups.push(current);
    return groups;
  }

  async function renderHomeTodo() {
    const today = todayISO();
    const now = new Date();
    $("#homeTodoDate").textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAY_LABEL[now.getDay()]})`;

    const [inspections, sites, todaySchedule] = await Promise.all([
      FireDB.getAllInspections(), FireDB.getAllSites(), FireDB.getScheduleByDate(today)
    ]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const lastBySite = computeLastInspectionBySite(inspections);
    // 점검완료 처리를 해도 목록에서 바로 사라지지 않고 "완료" 표시로 남아있게 한다(사용자 요청) -
    // 단, 오늘 완료한 것만 남기고(completedDate === today) 예전에 완료된 건 그대로 안 보이게 한다.
    const relevant = inspections.filter((i) => {
      if (i.status === "completed") return i.completedDate === today;
      return !!i.scheduledDate && i.scheduledDate <= today;
    });
    relevant.sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
    const relevantSiteIds = new Set(relevant.map((i) => i.siteId));

    // 스케줄 관리에서 오늘 날짜로 "일정 확정"한 방문도 오늘의 할일에 포함한다(사용자 요청) - 이미
    // 점검 기록(inspections)으로 오늘 할일에 뜬 거래처는 중복 표시하지 않는다.
    const confirmedSiteIds = (todaySchedule && todaySchedule.confirmed ? todaySchedule.siteIds : [])
      .filter((id) => siteMap.has(id) && !relevantSiteIds.has(id));

    const list = $("#homeTodoList");
    if (relevant.length === 0 && confirmedSiteIds.length === 0) {
      list.innerHTML = `<div class="home-todo-empty">오늘 예정된 할일이 없습니다.</div>`;
      return;
    }
    // 같은 거래처가 오늘 할일에 여러 번 뜨지 않게 한다(사용자 요청) - 예를 들어 예전에 밀린
    // 기한초과 건과 오늘 새로 잡힌 건이 같은 거래처에 둘 다 있으면 하나로 합친다. 완료 처리된
    // 게 있으면 그걸 대표로 보여주고(방금 처리한 결과가 눈에 보여야 하므로), 없으면 먼저
    // 나온(=scheduledDate가 가장 이른, 가장 급한) 건을 그대로 둔다.
    const inspectionItemsBySite = new Map();
    relevant.forEach((insp) => {
      const site = siteMap.get(insp.siteId);
      const done = insp.status === "completed";
      const isOverdue = !done && insp.scheduledDate < today;
      const last = site ? lastBySite.get(site.id) : null;
      const lastDate = last ? (last.completedDate || last.scheduledDate) : "";
      const subLine = done
        ? escapeHtml(insp.type || "점검")
        : `${escapeHtml(insp.type || "점검")} · ${isOverdue ? `기한초과 (${escapeHtml(insp.scheduledDate)})` : "오늘 예정"}`;
      const html = `
        <div class="home-todo-item ${isOverdue ? "is-overdue" : ""} ${done ? "is-done" : ""}" data-site-id="${insp.siteId}">
          <span class="home-todo-item-icon">${done ? "✅" : (isOverdue ? "⚠️" : "🔔")}</span>
          <div class="home-todo-item-body">
            <div class="home-todo-item-title-row">
              <span class="home-todo-item-title">${escapeHtml(site ? site.name : "알 수 없는 현장")}</span>
              ${done ? `<span class="badge badge-completed">완료</span>` : ""}
            </div>
            <div class="home-todo-item-sub">${subLine}</div>
            <div class="home-todo-item-sub">마지막 점검일: ${lastDate ? escapeHtml(lastDate) : "이력 없음"}</div>
            ${site && site.equipmentMemo ? `<div class="home-todo-item-memo">📝 ${escapeHtml(site.equipmentMemo)}</div>` : ""}
            ${site && (site.contactName || site.contactPhone) ? `
              <div class="home-todo-item-sub site-card-phone-row">
                <span>${site.contactName ? "담당자: " + escapeHtml(site.contactName) : "담당자 미입력"}</span>
                ${site.contactPhone ? `<a class="btn-call" href="tel:${escapeHtml(site.contactPhone)}">📞 전화걸기</a>` : ""}
              </div>
            ` : ""}
          </div>
        </div>
      `;
      const existing = inspectionItemsBySite.get(insp.siteId);
      if (!existing || (done && !existing.done)) {
        inspectionItemsBySite.set(insp.siteId, { siteId: insp.siteId, html, done });
      }
    });
    const inspectionItems = Array.from(inspectionItemsBySite.values());
    const scheduleItems = confirmedSiteIds.map((id) => {
      const site = siteMap.get(id);
      const last = lastBySite.get(id);
      const lastDate = last ? (last.completedDate || last.scheduledDate) : "";
      const html = `
        <div class="home-todo-item" data-site-id="${id}">
          <span class="home-todo-item-icon">📅</span>
          <div class="home-todo-item-body">
            <div class="home-todo-item-title">${escapeHtml(site.name)}</div>
            <div class="home-todo-item-sub">${escapeHtml(inspectionTypeForMonth(site, today))} · 오늘 방문 확정</div>
            <div class="home-todo-item-sub">마지막 점검일: ${lastDate ? escapeHtml(lastDate) : "이력 없음"}</div>
            ${site.equipmentMemo ? `<div class="home-todo-item-memo">📝 ${escapeHtml(site.equipmentMemo)}</div>` : ""}
            ${site.contactName || site.contactPhone ? `
              <div class="home-todo-item-sub site-card-phone-row">
                <span>${site.contactName ? "담당자: " + escapeHtml(site.contactName) : "담당자 미입력"}</span>
                ${site.contactPhone ? `<a class="btn-call" href="tel:${escapeHtml(site.contactPhone)}">📞 전화걸기</a>` : ""}
              </div>
            ` : ""}
          </div>
        </div>
      `;
      return { siteId: id, html };
    });
    // 스케줄 관리(오늘 날짜)에서 정한 방문 순서 그대로 표시(사용자 요청) - 그 순서에 없는 항목
    // (예: 여러 날짜 전부터 밀려온 기한초과 점검)은 순서 정보가 없으므로 뒤로 보내되, 그런
    // 항목끼리는 원래 순서(기한초과 날짜순)를 그대로 유지한다.
    const scheduleOrder = new Map((todaySchedule ? todaySchedule.siteIds : []).map((id, idx) => [id, idx]));
    const items = [...inspectionItems, ...scheduleItems];
    items.sort((a, b) => {
      const ra = scheduleOrder.has(a.siteId) ? scheduleOrder.get(a.siteId) : Infinity;
      const rb = scheduleOrder.has(b.siteId) ? scheduleOrder.get(b.siteId) : Infinity;
      return ra - rb;
    });
    list.innerHTML = items.map((it) => it.html).join("");
    $$("#homeTodoList .home-todo-item").forEach((el) => {
      el.addEventListener("click", () => openSiteDetail(el.dataset.siteId));
      const callBtn = el.querySelector(".btn-call");
      if (callBtn) callBtn.addEventListener("click", (e) => e.stopPropagation());
    });
  }

  async function goHome() {
    showScreen("screen-home");
    try {
      await renderHomeTodo();
    } catch (err) {
      toast((err && err.message) || "오늘의 할일을 불러오지 못했습니다.", "error");
    }
  }

  $("#appHeaderTitle").addEventListener("click", goHome);
  $("#btnHeaderHome").addEventListener("click", goHome);
  $("#btnHeaderBack").addEventListener("click", () => {
    const current = $(".screen.active");
    const delegateId = current && BACK_DELEGATE[current.id];
    if (delegateId) $("#" + delegateId).click();
    else goHome();
  });

  // ---------- 안드로이드 하드웨어 뒤로가기 버튼 ----------
  // @capacitor/app 플러그인이 없으면 웹뷰 기본 동작(뒤로 갈 브라우저 히스토리가 없으면 그냥 앱 종료)이
  // 그대로 발동해 어느 화면에서 눌러도 앱이 꺼져버렸다(실제 사용자가 겪은 문제) - 이 리스너가 화면
  // 전환/모달 닫기로 대신 처리하고("← 뒤로" 헤더 버튼과 완전히 같은 경로, BACK_DELEGATE 재사용),
  // 정말 홈 화면일 때만 실제 종료로 넘긴다.
  if (isNativeApp() && window.Capacitor.addListener) {
    window.Capacitor.addListener("App", "backButton", () => {
      const openModal = $$(".modal-overlay:not(.hidden), .photo-viewer-overlay:not(.hidden)")[0];
      if (openModal) {
        const closeBtn = openModal.querySelector("#confirmCancelBtn, #shareFormatCancelBtn, #btnClosePhotoViewer");
        if (closeBtn) { closeBtn.click(); return; }
      }
      const current = $(".screen.active");
      if (current && current.id === "screen-home") {
        callNativePlugin("App", "exitApp", {});
        return;
      }
      $("#btnHeaderBack").click();
    });
  }
  // "거래처 관리" 홈 타일 - 등록 방법 선택 화면을 열면서, 그 아래 기존 거래처 목록도 같이 보여준다.
  $("#btnHomeAddSite").addEventListener("click", () => {
    renderEntrySites().catch(reportLoadFailure);
    showScreen("screen-site-entry-choice");
  });
  // "점검팀" 홈 타일 - 기존 "거래처 보기"와 같은 화면(거래처 목록)을 그대로 연다.
  $("#btnHomeViewSites").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });
  // "공사팀" 홈 타일 - 업체 목록(거래처 재사용) → 견적서/공사내역 화면을 연다. 공사내역은
  // 점검팀 기록(inspections/deficiencies)과 완전히 분리된 별도 저장소(constructionJobs)라 두
  // 팀이 각자 관리한다(사용자 요청) - 점검팀이 "점검 완료 처리"를 누르면 그 날짜만 자동으로
  // 여기 하나 만들어지고, 이후 내용은 공사팀이 채운다.
  $("#btnHomeConstructionTeam").addEventListener("click", () => {
    renderConstructionTeam().catch(reportLoadFailure);
    showScreen("screen-construction-team");
  });
  $("#btnHomeScheduleManage").addEventListener("click", async () => {
    scheduleCalDate = new Date();
    await selectScheduleDate(todayISO());
    showScreen("screen-schedule-manage");
  });
  $("#btnBackFromScheduleManage").addEventListener("click", goHome);
  $("#btnBackFromConstructionTeam").addEventListener("click", goHome);

  // ---------- 공사팀 (업체 = 거래처 재사용, 견적서/공사내역은 업체별 하위 메뉴) ----------
  async function renderConstructionTeam() {
    const sites = await FireDB.getAllSites();
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const list = $("#constructionTeamList");
    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 업체가 없습니다.</div>`;
      return;
    }
    list.innerHTML = sites.map((s) => `
      <div class="list-card" data-id="${s.id}">
        <div class="list-card-title">${escapeHtml(s.name)}</div>
        <div class="list-card-sub">${s.address ? "📍 " + escapeHtml(s.address) : "주소 미입력"}</div>
      </div>
    `).join("");
    Array.from(list.querySelectorAll(".list-card")).forEach((el) => {
      el.addEventListener("click", () => openConstructionCompany(el.dataset.id));
    });
  }

  async function openConstructionCompany(id) {
    currentConstructionSiteId = id;
    const site = await FireDB.getSite(id);
    if (!site) { renderConstructionTeam(); showScreen("screen-construction-team"); return; }
    $("#constructionCompanyName").textContent = site.name;
    $("#constructionCompanyAddress").textContent = site.address || "";
    showScreen("screen-construction-company");
  }

  $("#btnBackFromConstructionCompany").addEventListener("click", () => { renderConstructionTeam(); showScreen("screen-construction-team"); });

  $("#btnConstructionEstimates").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentConstructionSiteId);
    $("#constructionEstimatesCompanyName").textContent = site ? site.name : "";
    showScreen("screen-construction-estimates");
  });
  $("#btnBackFromConstructionEstimates").addEventListener("click", () => showScreen("screen-construction-company"));

  $("#btnConstructionHistory").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentConstructionSiteId);
    $("#constructionHistoryCompanyName").textContent = site ? site.name : "";
    await renderConstructionHistory();
    showScreen("screen-construction-history");
  });
  $("#btnBackFromConstructionHistory").addEventListener("click", () => showScreen("screen-construction-company"));

  // ---------- 공사팀: 공사내역(constructionJobs) - 점검팀 기록과 분리된 날짜별 이력 ----------
  let currentConstructionJobId = null;

  async function renderConstructionHistory() {
    const jobs = await FireDB.getConstructionJobsBySite(currentConstructionSiteId);
    jobs.sort((a, b) => (b.date || "").localeCompare(a.date || "")); // 최근 날짜가 위로
    const list = $("#constructionHistoryList");
    if (jobs.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 공사내역이 없습니다.<br>점검팀이 점검을 완료 처리하면 자동으로 추가되거나, 직접 등록할 수 있습니다.</div>`;
      return;
    }
    list.innerHTML = jobs.map((j) => {
      const d = j.date ? new Date(j.date + "T00:00:00") : null;
      const dateLabel = d && !isNaN(d) ? `${j.date} (${WEEKDAY_LABEL[d.getDay()]})` : (j.date || "");
      return `
        <div class="list-card" data-job="${j.id}">
          <div class="list-card-title">
            <span class="list-card-title-main">${escapeHtml(dateLabel)}</span>
            <button type="button" class="list-card-menu-btn" data-menu-btn>⋯</button>
          </div>
          <div class="site-card-menu hidden" data-menu>
            <button type="button" data-menu-edit-date>날짜 수정</button>
            <button type="button" class="danger" data-menu-delete>삭제</button>
          </div>
          <div class="list-card-sub">${j.memo ? escapeHtml(j.memo) : "메모 없음"}</div>
        </div>
      `;
    }).join("");

    Array.from(list.querySelectorAll(".list-card")).forEach((el) => {
      const jobId = el.dataset.job;
      el.addEventListener("click", () => openConstructionJobDetail(jobId));
      const menuBtn = el.querySelector("[data-menu-btn]");
      const menu = el.querySelector("[data-menu]");
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = menu === openSiteCardMenu;
        closeSiteCardMenu();
        if (!wasOpen) { menu.classList.remove("hidden"); openSiteCardMenu = menu; }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.querySelector("[data-menu-edit-date]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const job = jobs.find((j) => j.id === jobId);
        const newDate = await promptDate("공사내역 날짜 수정", job.date);
        if (!newDate) return;
        await FireDB.updateConstructionJob(jobId, { date: newDate });
        await renderConstructionHistory();
      });
      menu.querySelector("[data-menu-delete]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const ok = await confirmDialog("이 공사내역을 삭제할까요?");
        if (!ok) return;
        await FireDB.deleteConstructionJob(jobId);
        await renderConstructionHistory();
      });
    });
  }

  $("#btnAddConstructionJob").addEventListener("click", async () => {
    const date = await promptDate("공사내역 날짜", todayISO());
    if (!date) return;
    await FireDB.addConstructionJob({ siteId: currentConstructionSiteId, date, memo: "", createdAt: new Date().toISOString() });
    await renderConstructionHistory();
  });

  async function openConstructionJobDetail(jobId) {
    currentConstructionJobId = jobId;
    const job = await FireDB.getConstructionJob(jobId);
    const d = job && job.date ? new Date(job.date + "T00:00:00") : null;
    $("#constructionJobDateLabel").textContent = d && !isNaN(d) ? `${job.date} (${WEEKDAY_LABEL[d.getDay()]})` : (job ? job.date : "");
    $("#constructionJobMemo").value = job ? (job.memo || "") : "";
    showScreen("screen-construction-job-detail");
  }

  $("#btnSaveConstructionJob").addEventListener("click", async () => {
    await FireDB.updateConstructionJob(currentConstructionJobId, { memo: $("#constructionJobMemo").value });
    toast("저장되었습니다.", "success");
    await renderConstructionHistory();
    showScreen("screen-construction-history");
  });

  $("#btnDeleteConstructionJob").addEventListener("click", async () => {
    const ok = await confirmDialog("이 공사내역을 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteConstructionJob(currentConstructionJobId);
    await renderConstructionHistory();
    showScreen("screen-construction-history");
  });

  $("#btnBackFromConstructionJobDetail").addEventListener("click", () => showScreen("screen-construction-history"));

  // ---------- 탭 ----------
  // 자료를 불러오다 실패/시간초과되면(예: 불안정한 네트워크) 화면은 바뀌었는데 내용은 계속
  // 비어있는 채로 남아 "눌러도 반응 없음"처럼 보일 수 있다 - 실패를 토스트로 반드시 보여준다.
  function reportLoadFailure(err) {
    toast((err && err.message) || "자료를 불러오지 못했습니다. 네트워크를 확인해주세요.", "error");
  }
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "screen-deficiency-hub") renderDeficiencyHub().catch(reportLoadFailure);
      if (tab === "screen-reports-hub") renderReportsHub().catch(reportLoadFailure);
      if (tab === "screen-sites") renderSites().catch(reportLoadFailure);
      if (tab === "screen-route") renderRoute().catch(reportLoadFailure);
      if (tab === "screen-settings") renderSettings().catch(reportLoadFailure);
      showScreen(tab);
    });
  });

  // 홈 화면의 버전 표시(.app-version-tag)가 탭바 바로 위에 오려면 실제 탭바 높이를 알아야 한다 -
  // 예전에는 44px로 고정해뒀는데, 그 뒤 탭바 폰트/아이콘 크기를 키우면서 탭바가 더 높아져 버전
  // 표시가 탭바 밑에 깔려 잘려 보이는 원인이 됐다(실제 사용자가 겪은 문제). 기기별 폰트 렌더링에
  // 따라 탭바 높이가 달라질 수 있어 고정값 대신 실제 렌더링된 높이를 CSS 변수로 넘긴다.
  function syncTabBarHeightVar() {
    const bar = $(".tab-bar");
    if (bar) document.documentElement.style.setProperty("--tab-bar-height", bar.offsetHeight + "px");
  }
  syncTabBarHeightVar();
  window.addEventListener("resize", syncTabBarHeightVar);

  // ================= 현장 =================
  function siteCardHtml(s, lastBySite) {
    const last = lastBySite.get(s.id);
    return `
      <div class="list-card" data-id="${s.id}">
        <div class="list-card-title">
          <span class="list-card-title-main">${escapeHtml(s.name)}</span>
          <button type="button" class="list-card-menu-btn" data-menu-btn>⋯</button>
        </div>
        <div class="site-card-menu hidden" data-menu>
          <button type="button" data-menu-edit>수정</button>
          <button type="button" class="danger" data-menu-delete>삭제</button>
        </div>
        ${inspectionScheduleBadgeHtml(s) ? `<div class="list-card-sub">${inspectionScheduleBadgeHtml(s)}</div>` : ""}
        <div class="list-card-sub">${s.address ? "📍 " + escapeHtml(s.address) : "주소 미입력"}</div>
        ${s.contactName ? `<div class="list-card-sub">담당자: ${escapeHtml(s.contactName)}</div>` : ""}
        <div class="list-card-sub">${last ? `마지막 점검일: ${escapeHtml(last.completedDate || last.scheduledDate)} · 점검자: ${escapeHtml(last.inspector || "-")}` : "점검 이력 없음"}</div>
        <div class="list-card-sub site-card-phone-row">
          <span>${s.contactPhone ? "📞 " + escapeHtml(formatPhone(s.contactPhone)) : "연락처 미입력"}</span>
          ${s.contactPhone ? `<a class="btn-call" href="tel:${escapeHtml(s.contactPhone)}">전화걸기</a>` : ""}
        </div>
      </div>
    `;
  }
  // 카드를 다시 그릴 때(정렬/지역 전환 등) 이전에 열려 있던 카드메뉴가 고아 상태로 남지 않도록,
  // 열려 있는 메뉴는 항상 문서 전역에서 하나만 추적하고 다른 곳을 클릭하면 닫는다.
  let openSiteCardMenu = null;
  function closeSiteCardMenu() {
    if (openSiteCardMenu) openSiteCardMenu.classList.add("hidden");
    openSiteCardMenu = null;
  }
  document.addEventListener("click", closeSiteCardMenu);
  function bindSiteCardClicks(container) {
    Array.from(container.querySelectorAll(".list-card")).forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener("click", () => openSiteDetail(id));
      const callBtn = el.querySelector(".btn-call");
      if (callBtn) callBtn.addEventListener("click", (e) => e.stopPropagation());
      const menuBtn = el.querySelector("[data-menu-btn]");
      const menu = el.querySelector("[data-menu]");
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = menu === openSiteCardMenu;
        closeSiteCardMenu();
        if (!wasOpen) { menu.classList.remove("hidden"); openSiteCardMenu = menu; }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.querySelector("[data-menu-edit]").addEventListener("click", () => {
        closeSiteCardMenu();
        openSiteEditForm(id);
      });
      menu.querySelector("[data-menu-delete]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const ok = await confirmDialog("거래처를 삭제 하시겠습니까?");
        if (!ok) return;
        await FireDB.deleteSite(id);
        renderSites();
      });
    });
  }
  function renderSiteCardsInto(list, sitesArr, lastBySite, emptyMessage) {
    if (sitesArr.length === 0) {
      list.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      return;
    }
    list.innerHTML = sitesArr.map((s) => siteCardHtml(s, lastBySite)).join("");
    bindSiteCardClicks(list);
  }

  // list/rerender를 인자로 받아서 "거래처 관리"(entrySitesList)와 "점검팀"(sitesList) 두 화면이
  // 정렬 상태(sitesSortMode/sitesSelectedRegion)를 공유하면서도 각자의 DOM에 그릴 수 있게 한다.
  function renderSitesByRegion(sites, lastBySite, list, rerender) {
    if (sitesSelectedRegion) {
      const filtered = sites.filter((s) => classifyRegion(s.address) === sitesSelectedRegion);
      const backBtnHtml = `<button class="btn btn-secondary region-back-row" type="button">← 지역 목록으로 (${escapeHtml(sitesSelectedRegion)})</button>`;
      if (filtered.length === 0) {
        list.innerHTML = `${backBtnHtml}<div class="empty-state">이 지역에 등록된 현장이 없습니다.</div>`;
      } else {
        list.innerHTML = backBtnHtml + filtered.map((s) => siteCardHtml(s, lastBySite)).join("");
        bindSiteCardClicks(list);
      }
      list.querySelector(".region-back-row").addEventListener("click", () => { sitesSelectedRegion = null; rerender(); });
      return;
    }

    // 지역 버튼 목록: 대구는 구/군 단위로, 그 외는 도/광역시 단위로, 실제로 거래처가 있는 지역만 표시.
    const counts = new Map();
    sites.forEach((s) => {
      const region = classifyRegion(s.address);
      counts.set(region, (counts.get(region) || 0) + 1);
    });
    const daeguOrder = DAEGU_DISTRICTS.filter((g) => counts.has(g));
    const otherOrder = PROVINCE_PATTERNS.map(([, label]) => label).filter((l) => l !== "대구" && counts.has(l));
    const orderedRegions = [...daeguOrder, ...otherOrder];
    if (counts.has("대구 기타")) orderedRegions.push("대구 기타");
    if (counts.has("지역 미상")) orderedRegions.push("지역 미상");

    list.innerHTML = `<div class="region-grid">${orderedRegions.map((r) => `
      <button class="region-btn" data-region="${escapeHtml(r)}">
        <span class="region-btn-name">${escapeHtml(r)}</span>
        <span class="region-btn-count">${counts.get(r)}개</span>
      </button>
    `).join("")}</div>`;
    Array.from(list.querySelectorAll(".region-btn")).forEach((btn) => {
      btn.addEventListener("click", () => { sitesSelectedRegion = btn.dataset.region; rerender(); });
    });
  }

  // "마지막 점검일"은 실제로 완료된 점검만 대상으로 한다 - 아직 완료되지 않은 예정 건은 날짜가 더 미래라도 "마지막"이 아니다.
  function computeLastInspectionBySite(inspections) {
    const lastBySite = new Map();
    inspections.forEach((insp) => {
      if (insp.status !== "completed") return;
      const d = insp.completedDate || insp.scheduledDate || "";
      const cur = lastBySite.get(insp.siteId);
      const curD = cur ? (cur.completedDate || cur.scheduledDate || "") : "";
      if (!cur || d > curD) lastBySite.set(insp.siteId, insp);
    });
    return lastBySite;
  }

  // 거래처 목록 렌더링 본체 - listElId/summaryElId/toolbarIds만 다르면 "거래처 관리" 화면 아래 목록과
  // "점검팀" 화면 둘 다 이 함수 하나로 그린다(정렬/지역/이번달 상태는 공유).
  async function renderSiteListInto(listElId, summaryElId, toolbarIds) {
    $("#" + toolbarIds.name).classList.toggle("active", sitesSortMode === "name");
    $("#" + toolbarIds.region).classList.toggle("active", sitesSortMode === "region");
    $("#" + toolbarIds.month).classList.toggle("active", sitesMonthOnly);

    const [allSites, inspections] = await Promise.all([FireDB.getAllSites(), FireDB.getAllInspections()]);
    allSites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const sites = sitesMonthOnly ? allSites.filter(isSiteInCurrentMonth) : allSites;

    const lastBySite = computeLastInspectionBySite(inspections);

    const list = $("#" + listElId);
    const summary = $("#" + summaryElId);
    const rerender = () => renderSiteListInto(listElId, summaryElId, toolbarIds);
    if (sites.length === 0) {
      summary.textContent = "";
      list.innerHTML = sitesMonthOnly
        ? `<div class="empty-state">이번 달 종합점검/작동점검 대상 거래처가 없습니다.</div>`
        : `<div class="empty-state">등록된 현장이 없습니다.<br>현장을 추가해 점검을 시작하세요.</div>`;
      return;
    }

    if (sitesSortMode === "region") {
      if (sitesSelectedRegion) {
        const inRegion = sites.filter((s) => classifyRegion(s.address) === sitesSelectedRegion).length;
        summary.innerHTML = `<strong>${sitesSelectedRegion}</strong> ${inRegion}개 · 전체 ${sites.length}개`;
      } else {
        const regionCount = new Set(sites.map((s) => classifyBroadRegion(s.address))).size;
        summary.innerHTML = `전체 <strong>${sites.length}개</strong> 거래처 · ${regionCount}개 지역`;
      }
      renderSitesByRegion(sites, lastBySite, list, rerender);
      return;
    }
    summary.innerHTML = `전체 <strong>${sites.length}개</strong> 거래처`;
    renderSiteCardsInto(list, sites, lastBySite, "등록된 현장이 없습니다.");
  }

  const SITES_TOOLBAR_IDS = { name: "btnSortByName", region: "btnSortByRegion", month: "btnFilterThisMonth" };
  const ENTRY_SITES_TOOLBAR_IDS = { name: "btnEntrySortByName", region: "btnEntrySortByRegion", month: "btnEntryFilterThisMonth" };

  function renderSites() {
    return renderSiteListInto("sitesList", "sitesSummary", SITES_TOOLBAR_IDS);
  }
  function renderEntrySites() {
    return renderSiteListInto("entrySitesList", "entrySitesSummary", ENTRY_SITES_TOOLBAR_IDS);
  }

  // 가나다순/지역별/이번달 툴바 버튼 3개를 한 화면분 통째로 연결한다 - "거래처 관리"/"점검팀" 두
  // 화면이 각자의 버튼 id만 다르고 나머지 동작은 동일해서 이 함수 하나로 양쪽을 다 연결한다.
  function wireSiteSortToolbar(toolbarIds, renderFn) {
    $("#" + toolbarIds.name).addEventListener("click", () => {
      sitesSortMode = "name";
      sitesSelectedRegion = null;
      renderFn();
    });
    $("#" + toolbarIds.region).addEventListener("click", () => {
      sitesSortMode = "region";
      renderFn();
    });
    $("#" + toolbarIds.month).addEventListener("click", () => {
      sitesMonthOnly = !sitesMonthOnly;
      renderFn();
    });
  }
  wireSiteSortToolbar(SITES_TOOLBAR_IDS, renderSites);
  wireSiteSortToolbar(ENTRY_SITES_TOOLBAR_IDS, renderEntrySites);

  // 방문 예약/이력(일정관리, 오늘의 할일, 마지막 점검일) 트리거 - "점검하기" 버튼을 누르면 그 날짜로
  // 점검 기록을 하나 만들고(같은 날짜가 이미 있으면 그걸 재사용), 점검 이력 목록에 날짜별 탭으로 쌓인다.
  async function getOrCreateInspectionForDate(siteId, dateStr, site) {
    const inspections = await FireDB.getInspectionsBySite(siteId);
    const existing = inspections.find((i) => i.scheduledDate === dateStr);
    if (existing) return existing;
    const insp = {
      siteId,
      type: inspectionTypeForMonth(site, dateStr),
      scheduledDate: dateStr,
      inspector: "",
      status: "scheduled",
      completedDate: null,
      createdAt: new Date().toISOString()
    };
    return FireDB.addInspection(insp);
  }

  const SITE_FORM_FIELDS = [
    "siteName", "siteAddress", "siteContactName", "siteContactPhone", "siteFireStation", "siteStation119",
    "siteBuildingType", "siteArea", "siteFloorInfo", "siteApprovalDate", "siteStructure",
    "siteFireManagerName", "siteFireManagerPhone", "siteFireManagerAppointDate", "siteFireManagerEduDate",
    "siteEngineerName", "siteEngineerPhone", "siteNotes",
    "siteReceiverLocation", "siteReceiverAccess", "sitePumpRoomLocation", "sitePumpRoomAccess", "siteEquipmentMemo"
  ];

  // "종합점검대상"/"종합점검 해당없음" 토글 - 이미 선택된 버튼을 다시 누르면 미정(null) 상태로 되돌아간다.
  function renderComprehensiveToggle(value) {
    comprehensiveTarget = value;
    $("#btnCompTargetYes").classList.toggle("active", value === true);
    $("#btnCompTargetNo").classList.toggle("active", value === false);
    renderMonthPickerButtons();
  }
  $("#btnCompTargetYes").addEventListener("click", () => renderComprehensiveToggle(comprehensiveTarget === true ? null : true));
  $("#btnCompTargetNo").addEventListener("click", () => renderComprehensiveToggle(comprehensiveTarget === false ? null : false));

  // 종합점검/작동점검 버튼에 현재 값(직접 지정한 값이 있으면 그 값, 없으면 자동계산 결과)을 표시.
  // "미정"은 종합점검대상 여부 자체를 아직 안 골랐을 때만 써야 한다 - comprehensiveTarget이 이미
  // true/false로 정해졌는데 사용승인일을 아직 몰라서(자동 인식 실패, 건축물대장 조회 전/실패 등)
  // 월을 못 구한 경우까지 똑같이 "미정"이라고 하면, "스프링클러 체크돼서 종합점검대상은 맞게 켜졌는데
  // 왜 미정으로 나오냐"는 오해를 산다(대상 여부 자체가 안 정해진 것으로 보임) - 실제로는 대상 여부는
  // 이미 정해졌고 사용승인일만 없는 것이므로 문구로 구분해준다.
  // isComprehensive: 종합점검 버튼(true)은 comprehensiveTarget===false일 때 원래부터 "해당없음"(날짜와
  // 무관하게 종합점검 자체가 없음)이지만, 작동점검 버튼(false)은 종합점검대상 여부와 무관하게 항상
  // 필요하므로 "해당없음"이라고 하면 안 되고 사용승인일이 없어서 못 구했다는 뜻으로 표시해야 한다.
  function monthPickerLabel(month, isComprehensive) {
    if (month) return `${month}월`;
    if (isComprehensive && comprehensiveTarget === false) return "해당없음";
    if (comprehensiveTarget === true || comprehensiveTarget === false) return "사용승인일 필요";
    return "미정";
  }
  function renderMonthPickerButtons() {
    const sched = computeInspectionMonths({
      comprehensiveTarget,
      approvalDate: $("#siteApprovalDate").value,
      comprehensiveMonthOverride: comprehensiveMonthValue,
      operationalMonthOverride: operationalMonthValue
    });
    $("#btnPickComprehensiveMonth").textContent = monthPickerLabel(sched && sched.comprehensiveMonth, true);
    $("#btnPickOperationalMonth").textContent = monthPickerLabel(sched && sched.operationalMonth, false);
  }
  $("#siteApprovalDate").addEventListener("input", renderMonthPickerButtons);

  // 월 그리드에서 고른 뒤에도 확인 다이얼로그를 한 번 더 거쳐야 실제로 반영된다 - 그리드 자체에서
  // 취소하거나 확인 다이얼로그에서 취소하면 기존 표시값 그대로 유지, 마지막에 "저장" 버튼을 눌러야
  // site.comprehensiveMonthOverride/operationalMonthOverride로 실제 저장된다(btnSaveSite 참고).
  $("#btnPickComprehensiveMonth").addEventListener("click", async () => {
    const month = await pickMonth("종합점검 월 선택");
    if (month === null) return;
    if (!(await confirmDialog(`종합점검을 ${month}월로 변경하시겠습니까?`))) return;
    comprehensiveMonthValue = month;
    renderMonthPickerButtons();
  });
  $("#btnPickOperationalMonth").addEventListener("click", async () => {
    const month = await pickMonth("작동점검 월 선택");
    if (month === null) return;
    if (!(await confirmDialog(`작동점검을 ${month}월로 변경하시겠습니까?`))) return;
    operationalMonthValue = month;
    renderMonthPickerButtons();
  });

  function openBlankSiteForm() {
    editingSiteId = null;
    pendingAttachments = [];
    $("#siteFormTitle").textContent = "현장 추가";
    SITE_FORM_FIELDS.forEach((id) => { $("#" + id).value = ""; });
    comprehensiveMonthValue = null;
    operationalMonthValue = null;
    renderComprehensiveToggle(null);
    $("#bldRegResult").classList.add("hidden");
    $("#importSummary").classList.add("hidden");
    lastAutoBldRegAddress = "";
    renderSiteAttachments();
    showScreen("screen-site-form");
  }

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  function attachmentRowHtml(id, filename, size, url) {
    return `
      <div class="list-card attachment-row">
        <div class="list-card-title">
          <a href="${url}" download="${escapeHtml(filename)}">${escapeHtml(filename)}</a>
        </div>
        <div class="list-card-sub">${formatFileSize(size)}</div>
        <button class="btn btn-danger btn-delete-attachment" data-att="${id}" type="button">삭제</button>
      </div>
    `;
  }

  async function renderSiteAttachments() {
    revokeObjectUrls();
    const list = $("#siteAttachmentsList");

    // 신규 현장(아직 저장 전)은 메모리 상의 pendingAttachments를 보여주고, 저장 시점에 실제 DB로 옮겨 담는다.
    if (!editingSiteId) {
      if (pendingAttachments.length === 0) {
        list.innerHTML = `<div class="empty-state">첨부된 자료가 없습니다.</div>`;
        return;
      }
      list.innerHTML = pendingAttachments.map((att) => {
        const url = URL.createObjectURL(att.blob);
        activeObjectUrls.push(url);
        return attachmentRowHtml(att.tempId, att.filename, att.size, url);
      }).join("");
      list.querySelectorAll(".btn-delete-attachment").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ok = await confirmDialog("이 자료를 삭제할까요?");
          if (!ok) return;
          pendingAttachments = pendingAttachments.filter((a) => a.tempId !== btn.dataset.att);
          renderSiteAttachments();
        });
      });
      return;
    }

    const attachments = await FireDB.getAttachmentsBySite(editingSiteId);
    if (attachments.length === 0) {
      list.innerHTML = `<div class="empty-state">첨부된 자료가 없습니다.</div>`;
      return;
    }
    list.innerHTML = attachments.map((att) => {
      const url = URL.createObjectURL(att.blob);
      activeObjectUrls.push(url);
      return attachmentRowHtml(att.id, att.filename, att.size, url);
    }).join("");
    list.querySelectorAll(".btn-delete-attachment").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog("이 자료를 삭제할까요?");
        if (!ok) return;
        await FireDB.deleteAttachment(btn.dataset.att);
        renderSiteAttachments();
      });
    });
  }

  $("#btnUploadAttachment").addEventListener("click", () => {
    $("#attachmentInput").click();
  });

  $("#attachmentInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (editingSiteId) {
      ImportLoading.show("자료를 저장하고 있습니다.");
      try {
        let idx = 0;
        for (const file of files) {
          idx++;
          ImportLoading.setProgress((idx / files.length) * 100, files.length > 1 ? `자료를 저장하고 있습니다. (${idx}/${files.length})` : "자료를 저장하고 있습니다.");
          await FireDB.addAttachment({
            siteId: editingSiteId,
            filename: file.name,
            size: file.size,
            blob: file,
            createdAt: new Date().toISOString()
          });
          await backupToDrive(editingSiteId, "첨부파일", file.name, file);
        }
      } finally {
        ImportLoading.hide();
      }
    } else {
      for (const file of files) {
        pendingAttachments.push({ tempId: FireDB.genId(), filename: file.name, size: file.size, blob: file });
      }
    }
    await renderSiteAttachments();
    toast(`${files.length}개 자료를 첨부했습니다.`);
  });

  // "취소"/헤더 뒤로가기 - 예전엔 거래처 목록 화면(screen-sites)으로 건너뛰었는데, 이제 이 화면
  // 자체에 거래처 목록이 있으니 그냥 원래 있던 화면(홈)으로 돌아간다(사용자 요청: 이전 페이지로만).
  $("#btnCancelEntryChoice").addEventListener("click", goHome);
  $("#btnEntryManual").addEventListener("click", openBlankSiteForm);
  $("#btnEntryImport").addEventListener("click", () => $("#clientImportInput").click());

  // 파일 입력 change 이벤트와 드래그앤드롭(handleClientImportDrop) 양쪽에서 재사용하도록 File
  // 객체를 직접 받는 함수로 분리했다.
  async function handleClientImportFile(file) {
    if (!file) return;
    ImportLoading.show(AiFill.isEnabled() ? "AI가 자료를 분석하고 있습니다." : "자료를 분석하고 있습니다.");
    ImportLoading.startSimulated();
    // 분석하는 동안 백그라운드로 같이 진행시키고, 함수를 빠져나가기 직전(finally)에 끝났는지 확인한다 -
    // 화면 전환 전에 실제로 완료됐다는 보장 없이 그냥 던져두면(fire-and-forget) 조용히 끊길 수 있다.
    let driveBackupPromise = Promise.resolve(null);
    try {
      let result = null;
      if (AiFill.isEnabled()) {
        try {
          // 구 HWP는 AiFill이 직접 다루지 못하므로(isSupportedExt에 없음), 여기서 먼저 hwpx로
          // 변환해서 넘겨준다 - 그래야 스프링클러설비 체크 여부(AI 분석 전용 필드, 종합점검대상
          // 자동판단에 쓰임)도 hwp 파일에서 인식된다. 변환 실패 시 원본 그대로 넘기면 AiFill이
          // unsupported 처리하고 기존 정규식 폴백으로 자연스럽게 이어진다.
          let aiFile = file;
          if (file.name.split(".").pop().toLowerCase() === "hwp") {
            const convertedHwpx = await ClientImport.convertHwpToHwpxViaService(file);
            if (convertedHwpx) aiFile = new File([convertedHwpx], file.name.replace(/\.hwp$/i, ".hwpx"));
          }
          const aiResult = await AiFill.analyzeClientFile(aiFile, (msg) => ImportLoading.setStatusText(msg));
          if (!aiResult.unsupported) result = aiResult;
        } catch (aiErr) {
          result = null; // AI 분석 실패 시 기존 방식으로 폴백
        }
      }
      if (!result) {
        result = await ClientImport.parseClientFile(file, (percent) =>
          ImportLoading.setProgress(percent, "사진에서 글자를 인식하고 있습니다.")
        );
      }
      // 담당기사(성명/연락처)는 자료에서 절대 자동으로 채우지 않는다(사용자 요청) - AI/정규식 추출
      // 쪽에서 이미 이 두 필드를 요청/인식하지 않도록 해뒀지만, 혹시라도 값이 섞여 들어오는 경로가
      // 생기더라도 폼에 닿기 전에 여기서 한 번 더 확실히 비운다.
      if (result && result.fields) {
        delete result.fields.engineerName;
        delete result.fields.engineerPhone;
      }
      {
        const guessName = (result.fields && result.fields.name) || file.name.replace(/\.[^.]+$/, "");
        driveBackupPromise = DriveBackup.uploadToSite(guessName, "거래처_등록자료", file.name, file).catch(() => null);
      }
      if (result.unsupported) {
        toast(`지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf, .hwp, .hwpx, 사진).`, "error");
        return;
      }
      openBlankSiteForm();
      if (result.failed) {
        $("#importSummary").classList.remove("hidden");
        $("#importSummary").textContent = `${result.typeLabel}에서 자동으로 인식된 항목이 없습니다. 아래 내용을 직접 입력해주세요.`;
        toast(`${result.typeLabel}에서 인식된 정보가 없습니다. 직접 입력해주세요.`, "error");
        return;
      }
      const map = {
        name: "siteName", address: "siteAddress",
        contactName: "siteContactName", contactPhone: "siteContactPhone",
        fireManagerName: "siteFireManagerName", fireManagerPhone: "siteFireManagerPhone",
        fireManagerAppointDate: "siteFireManagerAppointDate", fireManagerEduDate: "siteFireManagerEduDate",
        receiverLocation: "siteReceiverLocation", pumpRoomLocation: "sitePumpRoomLocation",
        area: "siteArea", approvalDate: "siteApprovalDate", floorInfo: "siteFloorInfo",
        buildingType: "siteBuildingType"
      };
      let filledCount = 0;
      Object.entries(map).forEach(([field, id]) => {
        if (result.fields[field]) { $("#" + id).value = result.fields[field]; filledCount++; }
      });
      // 스프링클러설비 체크 여부(AI 분석 전용 - 정규식 폴백 경로에는 이 필드가 없음)로 종합점검대상 토글을 미리 맞춰준다.
      // 사용자가 내용을 확인하고 필요하면 직접 다시 눌러 바꿀 수 있다.
      if (result.fields.sprinklerInstalled === "예") renderComprehensiveToggle(true);
      else if (result.fields.sprinklerInstalled === "아니오") renderComprehensiveToggle(false);
      $("#importSummary").classList.remove("hidden");
      $("#importSummary").textContent = `${result.typeLabel}에서 ${filledCount}개 항목을 자동으로 채웠습니다.${result.lowConfidence ? " 인식 품질이 낮을 수 있으니 내용을 꼭 확인해주세요." : " 내용을 확인 후 저장해주세요."}`;
      toast(`${result.typeLabel}에서 ${filledCount}개 항목을 채웠습니다. 내용을 확인해주세요.`);
      if (result.fields.address) {
        lastAutoBldRegAddress = result.fields.address;
        lookupBldRegForCurrentAddress();
      }
    } catch (err) {
      toast("파일을 분석하는 중 오류가 발생했습니다. 직접 입력해주세요.", "error");
      openBlankSiteForm();
    } finally {
      await driveBackupPromise;
      ImportLoading.hide();
    }
  }
  $("#clientImportInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    handleClientImportFile(file);
  });
  // 탐색기/다른 폴더에서 파일을 끌어다 놓아도 "자료 불러오기" 버튼을 누른 것과 똑같이 동작하도록
  // 현장 등록 방식 선택 화면 전체를 드롭 영역으로 둔다.
  setupFileDropZone($("#screen-site-entry-choice"), handleClientImportFile);

  $("#btnCancelSiteForm").addEventListener("click", () => {
    if (editingSiteId) openSiteDetail(editingSiteId); else { renderSites(); showScreen("screen-sites"); }
  });

  // 주소가 같은 현장은 새로 만들지 않고 기존 현장에 합친다 - 공백 차이 정도만 무시하는 단순 정규화 비교.
  function normalizeAddress(addr) {
    return (addr || "").replace(/\s+/g, "").trim();
  }

  const SITE_FIELD_LABELS = {
    name: "현장명", address: "주소", contactName: "담당자명", contactPhone: "담당자 연락처",
    fireStation: "관할소방서", station119: "관할119안전센터",
    buildingType: "건물 용도", area: "연면적", floorInfo: "층수", approvalDate: "사용승인일", structure: "구조",
    fireManagerName: "소방안전관리자 성명", fireManagerPhone: "소방안전관리자 연락처",
    fireManagerAppointDate: "선임일자", fireManagerEduDate: "교육일자",
    engineerName: "담당기사 성명", engineerPhone: "담당기사 연락처",
    receiverLocation: "수신기 위치", receiverAccess: "수신기 접근방법",
    pumpRoomLocation: "펌프실 위치", pumpRoomAccess: "펌프실 접근방법",
    equipmentMemo: "메모", notes: "비고",
    comprehensiveTarget: "종합점검대상 여부",
    comprehensiveMonthOverride: "종합점검월(직접지정)", operationalMonthOverride: "작동점검월(직접지정)"
  };

  const NUMBER_FIELDS = new Set(["comprehensiveMonthOverride", "operationalMonthOverride"]);

  // 새로 입력/인식된 값 중 실제로 뭔가 채워진 것만 기존 현장 위에 덮어쓴다 - 새 값이 비어 있으면
  // (예: 이번엔 그 항목이 인식/입력되지 않음) 기존에 저장돼 있던 값을 그대로 유지한다.
  function mergeSiteData(oldSite, newData) {
    const merged = { ...oldSite };
    for (const key of Object.keys(newData)) {
      const nv = newData[key];
      if (key === "comprehensiveTarget") {
        if (typeof nv === "boolean") merged[key] = nv;
        continue;
      }
      if (NUMBER_FIELDS.has(key)) {
        if (typeof nv === "number") merged[key] = nv;
        continue;
      }
      if (nv !== undefined && nv !== null && String(nv).trim() !== "") merged[key] = nv;
    }
    return merged;
  }

  function diffSiteFields(oldSite, newSite) {
    const changes = [];
    for (const key of Object.keys(SITE_FIELD_LABELS)) {
      const isBool = key === "comprehensiveTarget";
      const isNum = NUMBER_FIELDS.has(key);
      const ov = isBool ? (typeof oldSite[key] === "boolean" ? String(oldSite[key]) : "")
        : isNum ? (typeof oldSite[key] === "number" ? String(oldSite[key]) : "")
        : String(oldSite[key] || "").trim();
      const nv = isBool ? (typeof newSite[key] === "boolean" ? String(newSite[key]) : "")
        : isNum ? (typeof newSite[key] === "number" ? String(newSite[key]) : "")
        : String(newSite[key] || "").trim();
      // 주소는 공백 차이만 있으면(중복 판정에 쓰는 정규화와 동일 기준) 실질적으로 안 바뀐 것으로 본다.
      const same = key === "address" ? normalizeAddress(ov) === normalizeAddress(nv) : ov === nv;
      if (nv && !same) changes.push({ field: key, label: SITE_FIELD_LABELS[key], oldValue: ov, newValue: nv });
    }
    return changes;
  }

  async function saveSiteAttachments(siteId, siteName) {
    for (const att of pendingAttachments) {
      await FireDB.addAttachment({
        siteId,
        filename: att.filename,
        size: att.size,
        blob: att.blob,
        createdAt: new Date().toISOString()
      });
      await DriveBackup.uploadToSite(siteName, "첨부파일", att.filename, att.blob).catch(() => null);
    }
    pendingAttachments = [];
  }

  $("#btnSaveSite").addEventListener("click", async () => {
    const name = $("#siteName").value.trim();
    if (!name) { toast("현장명을 입력해주세요.", "error"); return; }
    const data = {
      name,
      address: $("#siteAddress").value.trim(),
      contactName: $("#siteContactName").value.trim(),
      contactPhone: $("#siteContactPhone").value.trim(),
      fireStation: $("#siteFireStation").value.trim(),
      station119: $("#siteStation119").value.trim(),
      comprehensiveTarget,
      comprehensiveMonthOverride: comprehensiveMonthValue,
      operationalMonthOverride: operationalMonthValue,
      buildingType: $("#siteBuildingType").value.trim(),
      area: $("#siteArea").value.trim(),
      floorInfo: $("#siteFloorInfo").value.trim(),
      approvalDate: $("#siteApprovalDate").value.trim(),
      structure: $("#siteStructure").value.trim(),
      fireManagerName: $("#siteFireManagerName").value.trim(),
      fireManagerPhone: $("#siteFireManagerPhone").value.trim(),
      fireManagerAppointDate: $("#siteFireManagerAppointDate").value.trim(),
      fireManagerEduDate: $("#siteFireManagerEduDate").value.trim(),
      engineerName: $("#siteEngineerName").value.trim(),
      engineerPhone: $("#siteEngineerPhone").value.trim(),
      receiverLocation: $("#siteReceiverLocation").value.trim(),
      receiverAccess: $("#siteReceiverAccess").value.trim(),
      pumpRoomLocation: $("#sitePumpRoomLocation").value.trim(),
      pumpRoomAccess: $("#sitePumpRoomAccess").value.trim(),
      equipmentMemo: $("#siteEquipmentMemo").value.trim(),
      notes: $("#siteNotes").value.trim()
    };
    if (editingSiteId) {
      const before = await FireDB.getSite(editingSiteId);
      const changes = diffSiteFields(before, data);
      if (changes.length > 0) data.changeHistory = [...(before.changeHistory || []), { date: new Date().toISOString(), changes }];
      await FireDB.updateSite(editingSiteId, data);
      openSiteDetail(editingSiteId);
      return;
    }
    const normAddr = normalizeAddress(data.address);
    const existing = normAddr ? (await FireDB.getAllSites()).find((s) => normalizeAddress(s.address) === normAddr) : null;
    if (existing) {
      const merged = mergeSiteData(existing, data);
      const changes = diffSiteFields(existing, merged);
      if (changes.length > 0) merged.changeHistory = [...(existing.changeHistory || []), { date: new Date().toISOString(), changes }];
      await FireDB.updateSite(existing.id, merged);
      await saveSiteAttachments(existing.id, merged.name);
      renderSites();
      showScreen("screen-sites");
      openSiteDetail(existing.id);
      toast("주소가 같은 기존 현장을 찾아 정보를 갱신했습니다.", "success");
    } else {
      data.createdAt = new Date().toISOString();
      const site = await FireDB.addSite(data);
      await saveSiteAttachments(site.id, site.name);
      renderSites();
      showScreen("screen-sites");
      openSiteDetail(site.id);
    }
  });

  let lastAutoBldRegAddress = "";

  // 지상/지하 최고 층수를 "지상 n층 / 지하 n층" 텍스트로 - 지하는 0층(=지하 없음)이면 "지하 0층"이
  // 아니라 "지하 -"로 표시한다.
  function floorRangeText(max, label) {
    if (max == null) return "";
    return label === "지하" && max === 0 ? "지하 -" : `${label} ${max}층`;
  }
  function formatApprovalDate(raw) {
    return /^\d{8}$/.test(raw || "") ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : (raw || "");
  }

  // 거래처명이 "OO상가1"처럼 "상가" 뒤에 번호가 붙어 있으면, 표제부(대지 내 모든 동)에서 동명칭에
  // "상가"와 그 번호가 함께 들어간 동 하나를 찾아 그 동의 주용도/연면적/층수를 그대로 가져온다
  // (여러 동을 합치지 않음 - 사용자 요청). "상가" 뒤에 번호가 없으면 "상가"만 포함된 동으로 찾는다.
  async function lookupShoppingCenterBldReg(siteName, address, resultBox) {
    const numMatch = siteName.match(/상가\s*(\d+)/);
    const number = numMatch ? numMatch[1] : null;
    const result = await BldReg.lookupShoppingDong(address, number);
    const item = result.item;
    if (!item) {
      resultBox.innerHTML = `<div class="bldreg-error">표제부에서 동명칭에 "상가"가 포함된 동을 찾지 못했습니다. 건물명·주소를 확인하거나 직접 입력해주세요.</div>`;
      return;
    }
    const floorInfo = [floorRangeText(item.grndFlrCnt ? parseInt(item.grndFlrCnt, 10) : null, "지상"), floorRangeText(item.ugrndFlrCnt ? parseInt(item.ugrndFlrCnt, 10) : null, "지하")].filter(Boolean).join(" / ");
    const fetched = {
      buildingType: item.mainPurpsCdNm || "",
      area: item.totArea || "",
      floorInfo
    };
    if (fetched.buildingType) $("#siteBuildingType").value = fetched.buildingType;
    if (fetched.area) $("#siteArea").value = fetched.area;
    if (fetched.floorInfo) $("#siteFloorInfo").value = fetched.floorInfo;
    resultBox.innerHTML = `
      <div class="report-meta-row"><span class="label">대장구분</span><span>표제부 (상가${number ? " " + escapeHtml(number) : ""})</span></div>
      <div class="report-meta-row"><span class="label">동명칭</span><span>${escapeHtml(item.dongNm || "-")}</span></div>
      <div class="report-meta-row"><span class="label">주용도</span><span>${escapeHtml(fetched.buildingType || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(fetched.area ? fetched.area + " ㎡" : "-")}</span></div>
      <div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(fetched.floorInfo || "-")}</span></div>
      <div class="hint-text">거래처명의 "상가${number ? number : ""}"와 동명칭이 일치하는 동의 정보를 불러왔습니다. 내용이 다르면 직접 수정해주세요.</div>
    `;
    toast("표제부에서 해당 상가 동 정보를 불러왔습니다.");
  }

  async function lookupBldRegForCurrentAddress() {
    const address = $("#siteAddress").value.trim();
    const resultBox = $("#bldRegResult");
    if (!address) { toast("주소를 먼저 입력해주세요.", "error"); return; }
    const keys = BldReg.getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      resultBox.classList.remove("hidden");
      resultBox.innerHTML = `<div class="bldreg-error">건축물대장 조회를 사용하려면 '설정' 탭에서 API 키를 먼저 저장해주세요 (도로명주소 API 키, 공공데이터포털 건축물대장 인증키).</div>`;
      return;
    }
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<div class="report-meta-row"><span class="label">상태</span><span>건축물대장 조회 중...</span></div>`;
    try {
      const siteName = $("#siteName").value.trim();
      if (siteName.includes("상가")) {
        await lookupShoppingCenterBldReg(siteName, address, resultBox);
        return;
      }
      const { item, source, floorSummary } = await BldReg.lookup(address);
      if (!item) {
        resultBox.innerHTML = `<div class="bldreg-error">해당 주소의 건축물대장을 찾지 못했습니다. 주소를 정확히 입력했는지 확인하거나 직접 입력해주세요.</div>`;
        return;
      }
      const rawApprovalDate = item.useAprDay || "";
      // 총괄표제부는 대지 전체 집계값(연면적 등)만 갖고 동별 층수/구조는 없다 - 이 경우
      // floorSummary(대지 내 모든 동의 표제부에서 집계)로 층수/구조를 채운다.
      // 동마다 층수가 달라도(floorSummary) 범위 대신 그중 가장 높은 층수만 표시.
      let floorInfo = [floorRangeText(item.grndFlrCnt ? parseInt(item.grndFlrCnt, 10) : null, "지상"), floorRangeText(item.ugrndFlrCnt ? parseInt(item.ugrndFlrCnt, 10) : null, "지하")].filter(Boolean).join(" / ");
      if (!floorInfo && floorSummary) {
        floorInfo = [floorRangeText(floorSummary.grndMax, "지상"), floorRangeText(floorSummary.ugrndMax, "지하")].filter(Boolean).join(" / ");
      }
      let structure = item.strctCdNm || "";
      if (!structure && floorSummary && floorSummary.structures.length) {
        structure = floorSummary.structures.join(", ");
      }
      const fetched = {
        buildingType: item.mainPurpsCdNm || "",
        area: item.totArea || "",
        floorInfo,
        approvalDate: formatApprovalDate(rawApprovalDate),
        structure
      };
      // 건축물대장이 실제로 값을 준 항목만 덮어쓴다 - 특정 항목을 비워서 응답하면(예: 연면적 "-")
      // 자료 불러오기로 이미 채워둔 값을 빈 값으로 지워버리지 않도록 보존한다.
      if (fetched.buildingType) $("#siteBuildingType").value = fetched.buildingType;
      if (fetched.area) $("#siteArea").value = fetched.area;
      if (fetched.floorInfo) $("#siteFloorInfo").value = fetched.floorInfo;
      if (fetched.approvalDate) $("#siteApprovalDate").value = fetched.approvalDate;
      if (fetched.structure) $("#siteStructure").value = fetched.structure;
      const registerLabel = item.regstrKindCdNm || (source === "recap" ? "총괄표제부" : "표제부");
      resultBox.innerHTML = `
        <div class="report-meta-row"><span class="label">대장구분</span><span>${escapeHtml(registerLabel)}</span></div>
        <div class="report-meta-row"><span class="label">건물명</span><span>${escapeHtml(item.bldNm || "-")}</span></div>
        <div class="report-meta-row"><span class="label">주용도</span><span>${escapeHtml(fetched.buildingType || "-")}</span></div>
        <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(fetched.area ? fetched.area + " ㎡" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(fetched.floorInfo || "-")}</span></div>
        <div class="report-meta-row"><span class="label">구조</span><span>${escapeHtml(fetched.structure || "-")}</span></div>
        <div class="report-meta-row"><span class="label">사용승인일</span><span>${escapeHtml(fetched.approvalDate || "-")}</span></div>
        <div class="hint-text">건축물대장 정보로 자동으로 채웠습니다. 내용이 다르면 직접 수정해주세요.</div>
      `;
      toast("건축물대장 정보를 자동으로 불러왔습니다.");
    } catch (err) {
      let msg = "건축물대장 조회 중 오류가 발생했습니다.";
      if (String(err.message).startsWith("juso_")) msg = "주소 검색(도로명주소 API) 조회에 실패했습니다. 주소나 API 키를 확인해주세요.";
      else if (String(err.message).startsWith("bldreg_")) msg = "건축물대장 조회(공공데이터포털)에 실패했습니다. API 키 또는 서비스 활용신청 상태를 확인해주세요.";
      else if (err.name === "TypeError") msg = "네트워크 요청이 브라우저 보안 정책(CORS)에 막혔을 수 있습니다. 정부24에서 직접 열람해주세요.";
      resultBox.innerHTML = `<div class="bldreg-error">${escapeHtml(msg)}</div><button class="btn btn-secondary bldreg-actions" id="btnOpenGov24" type="button">정부24에서 건축물대장 열람 열기</button>`;
      $("#btnOpenGov24").addEventListener("click", () => window.open("https://www.gov.kr/mw/AA020InfoCappView.do?HighCtgCD=A01015&CappBizCD=13100000015", "_blank"));
    }
  }

  // 관할소방서 칸은 이제 직접 입력하지 않고(readonly) 주소만으로 항상 자동 표시한다 - 이행완료보고서 생성 시
  // 쓰이는 값(site.fireStation)과 완전히 같은 guessFireStation() 결과이므로 보고서 쪽 로직은 그대로 유지된다.
  function autoSuggestFireStation(address) {
    $("#siteFireStation").value = guessFireStation(address) || "";
  }

  $("#siteAddress").addEventListener("input", () => {
    autoSuggestFireStation($("#siteAddress").value.trim());
  });

  $("#btnLookupBldReg").addEventListener("click", () => {
    lastAutoBldRegAddress = $("#siteAddress").value.trim();
    lookupBldRegForCurrentAddress();
    autoSuggestFireStation(lastAutoBldRegAddress);
  });

  $("#siteAddress").addEventListener("blur", () => {
    const address = $("#siteAddress").value.trim();
    if (address && address !== lastAutoBldRegAddress) {
      lastAutoBldRegAddress = address;
      lookupBldRegForCurrentAddress();
    }
    autoSuggestFireStation(address);
  });

  async function openSiteDetail(id) {
    currentSiteId = id;
    const site = await FireDB.getSite(id);
    if (!site) { renderSites(); showScreen("screen-sites"); return; }
    $("#siteDetailInfo").innerHTML = `
      <h2 class="site-form-title-row"><span>${escapeHtml(site.name)}</span>${inspectionScheduleBadgeHtml(site)}</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site.address || "-")}</span></div>
      <div class="report-meta-row"><span class="label">관할소방서</span><span>${escapeHtml(site.fireStation || "-")}</span></div>
      <div class="report-meta-row"><span class="label">관할119안전센터</span><span>${escapeHtml(site.station119 || "-")}</span></div>
      <div class="report-meta-row"><span class="label">담당자</span><span>${escapeHtml(site.contactName || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연락처</span><span>${escapeHtml(site.contactPhone ? formatPhone(site.contactPhone) : "-")}</span></div>
      <div class="report-meta-row"><span class="label">건물 용도</span><span>${escapeHtml(site.buildingType || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(site.area ? site.area + " ㎡" : "-")}</span></div>
      ${site.floorInfo ? `<div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(site.floorInfo)}</span></div>` : ""}
      ${site.structure ? `<div class="report-meta-row"><span class="label">구조</span><span>${escapeHtml(site.structure)}</span></div>` : ""}
      ${site.approvalDate ? `<div class="report-meta-row"><span class="label">사용승인일</span><span>${escapeHtml(site.approvalDate)}</span></div>` : ""}
      ${site.fireManagerName ? `<div class="report-meta-row"><span class="label">소방안전관리자</span><span>${escapeHtml(site.fireManagerName)}${site.fireManagerPhone ? " · " + escapeHtml(formatPhone(site.fireManagerPhone)) : ""}</span></div>` : ""}
      ${site.fireManagerAppointDate ? `<div class="report-meta-row"><span class="label">선임일자</span><span>${escapeHtml(site.fireManagerAppointDate)}</span></div>` : ""}
      ${site.fireManagerEduDate ? `<div class="report-meta-row"><span class="label">교육일자</span><span>${escapeHtml(site.fireManagerEduDate)}</span></div>` : ""}
      ${site.engineerName ? `<div class="report-meta-row"><span class="label">담당기사</span><span>${escapeHtml(site.engineerName)}${site.engineerPhone ? " · " + escapeHtml(formatPhone(site.engineerPhone)) : ""}</span></div>` : ""}
      ${site.receiverLocation ? `<div class="report-meta-row"><span class="label">수신기 위치</span><span>${escapeHtml(site.receiverLocation)}</span></div>` : ""}
      ${site.receiverAccess ? `<div class="report-meta-row"><span class="label">수신기 접근방법</span><span>${escapeHtml(site.receiverAccess)}</span></div>` : ""}
      ${site.pumpRoomLocation ? `<div class="report-meta-row"><span class="label">펌프실 위치</span><span>${escapeHtml(site.pumpRoomLocation)}</span></div>` : ""}
      ${site.pumpRoomAccess ? `<div class="report-meta-row"><span class="label">펌프실 접근방법</span><span>${escapeHtml(site.pumpRoomAccess)}</span></div>` : ""}
      ${site.equipmentMemo ? `<div class="report-meta-row"><span class="label">메모</span><span>${escapeHtml(site.equipmentMemo)}</span></div>` : ""}
      ${site.notes ? `<div class="report-meta-row"><span class="label">비고</span><span>${escapeHtml(site.notes)}</span></div>` : ""}
    `;
    const history = site.changeHistory || [];
    $("#siteChangeHistorySection").classList.toggle("hidden", history.length === 0 || !isChangeHistoryVisible());
    $("#siteChangeHistoryList").innerHTML = history.slice().reverse().map((h) => `
      <div class="change-history-entry">
        <div class="change-history-date">${escapeHtml((h.date || "").slice(0, 10))}</div>
        <div class="change-history-summary">${h.changes.map((c) => `${escapeHtml(c.label)}: ${escapeHtml(c.oldValue || "(없음)")} → ${escapeHtml(c.newValue)}`).join(", ")}</div>
      </div>
    `).join("");

    selectedInspectionDate = todayISO();
    renderInspectionDateButton();

    const inspections = await FireDB.getInspectionsBySite(id);
    inspections.sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
    const listEl = $("#siteInspectionsList");
    if (inspections.length === 0) {
      listEl.innerHTML = `<div class="empty-state">점검 이력이 없습니다. "점검하기"를 눌러 오늘 방문을 시작하세요.</div>`;
    } else {
      // 종합/작동점검이 하루에 안 끝나고 며칠 연속 걸리는 경우가 있어, 방문 날짜가 캘린더상
      // 연속되면 테두리 하나로 묶고 위에 "시작일 ~ 종료일 (N일간)"을 붙인다(사용자 요청) -
      // 지적사항 회차 목록과 같은 방식(groupConsecutiveByDate 공용).
      listEl.innerHTML = groupConsecutiveByDate(inspections, (i) => i.scheduledDate).map((group) => {
        if (group.length < 2) return inspectionCardHtml(group[0], site);
        const endDate = group[0].scheduledDate;
        const startDate = group[group.length - 1].scheduledDate;
        return `
          <div class="date-group">
            <div class="date-group-header">${escapeHtml(startDate)} ~ ${escapeHtml(endDate)} (${group.length}일간)</div>
            ${group.map((i) => inspectionCardHtml(i, site)).join("")}
          </div>
        `;
      }).join("");
      Array.from(listEl.querySelectorAll(".list-card")).forEach((el) => {
        const inspId = el.dataset.id;
        el.addEventListener("click", () => openInspectionDetail(inspId));
        const menuBtn = el.querySelector("[data-menu-btn]");
        const menu = el.querySelector("[data-menu]");
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const wasOpen = menu === openSiteCardMenu;
          closeSiteCardMenu();
          if (!wasOpen) { menu.classList.remove("hidden"); openSiteCardMenu = menu; }
        });
        menu.addEventListener("click", (e) => e.stopPropagation());
        menu.querySelector("[data-menu-edit]").addEventListener("click", async () => {
          closeSiteCardMenu();
          const insp = inspections.find((i) => i.id === inspId);
          const newDate = await promptDate("점검 날짜 수정", insp.scheduledDate);
          if (!newDate) return;
          await FireDB.updateInspection(inspId, { scheduledDate: newDate });
          await openSiteDetail(id);
        });
        menu.querySelector("[data-menu-delete]").addEventListener("click", async () => {
          closeSiteCardMenu();
          const ok = await confirmDialog("이 점검 기록과 등록된 사진을 삭제할까요? 이 작업은 되돌릴 수 없습니다.");
          if (!ok) return;
          await FireDB.deleteInspection(inspId);
          await openSiteDetail(id);
        });
      });
    }
    showScreen("screen-site-detail");
  }

  function formatDateWithWeekday(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABEL[d.getDay()]})`;
  }

  function renderInspectionDateButton() {
    $("#btnEditInspectionDate").textContent = `${formatDateWithWeekday(selectedInspectionDate)} ✎`;
  }

  // "점검하기" 버튼 위의 날짜 - 기본은 오늘 날짜지만, 다른 날짜로 점검을 시작/기록해야 할 때를
  // 대비해 눌러서 바꿀 수 있게 한다(예: 어제 방문했는데 오늘 입력하는 경우).
  $("#btnEditInspectionDate").addEventListener("click", async () => {
    const newDate = await promptDate("점검 날짜 선택", selectedInspectionDate);
    if (!newDate) return;
    selectedInspectionDate = newDate;
    renderInspectionDateButton();
  });

  $("#btnStartInspection").addEventListener("click", async () => {
    if (!currentSiteId) return;
    const site = await FireDB.getSite(currentSiteId);
    const insp = await getOrCreateInspectionForDate(currentSiteId, selectedInspectionDate, site);
    await openInspectionDetail(insp.id);
  });

  $("#btnBackToSites").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });

  // 현장 상세 화면의 "현장 정보 수정" 버튼과 거래처 목록 카드메뉴의 "수정" 둘 다 여기로 들어온다.
  async function openSiteEditForm(id) {
    currentSiteId = id;
    const site = await FireDB.getSite(id);
    editingSiteId = id;
    $("#siteFormTitle").textContent = "현장 정보 수정";
    $("#siteName").value = site.name || "";
    $("#siteAddress").value = site.address || "";
    $("#siteContactName").value = site.contactName || "";
    $("#siteContactPhone").value = site.contactPhone || "";
    autoSuggestFireStation(site.address || "");
    $("#siteStation119").value = site.station119 || "";
    $("#siteBuildingType").value = site.buildingType || "";
    $("#siteArea").value = site.area || "";
    $("#siteFloorInfo").value = site.floorInfo || "";
    $("#siteApprovalDate").value = site.approvalDate || "";
    $("#siteStructure").value = site.structure || "";
    // renderComprehensiveToggle이 renderMonthPickerButtons도 함께 호출하므로, 그 안에서 읽는
    // siteApprovalDate 값이 이미 채워진 뒤(위 줄들 이후)에 불러야 한다.
    comprehensiveMonthValue = typeof site.comprehensiveMonthOverride === "number" ? site.comprehensiveMonthOverride : null;
    operationalMonthValue = typeof site.operationalMonthOverride === "number" ? site.operationalMonthOverride : null;
    renderComprehensiveToggle(typeof site.comprehensiveTarget === "boolean" ? site.comprehensiveTarget : null);
    $("#siteFireManagerName").value = site.fireManagerName || "";
    $("#siteFireManagerPhone").value = site.fireManagerPhone || "";
    $("#siteFireManagerAppointDate").value = site.fireManagerAppointDate || "";
    $("#siteFireManagerEduDate").value = site.fireManagerEduDate || "";
    $("#siteEngineerName").value = site.engineerName || "";
    $("#siteEngineerPhone").value = site.engineerPhone || "";
    $("#siteReceiverLocation").value = site.receiverLocation || "";
    $("#siteReceiverAccess").value = site.receiverAccess || "";
    $("#sitePumpRoomLocation").value = site.pumpRoomLocation || "";
    $("#sitePumpRoomAccess").value = site.pumpRoomAccess || "";
    $("#siteEquipmentMemo").value = site.equipmentMemo || "";
    $("#siteNotes").value = site.notes || "";
    $("#bldRegResult").classList.add("hidden");
    $("#importSummary").classList.add("hidden");
    lastAutoBldRegAddress = site.address || "";
    renderSiteAttachments();
    showScreen("screen-site-form");
  }
  $("#btnEditSite").addEventListener("click", () => openSiteEditForm(currentSiteId));

  $("#btnDeleteSite").addEventListener("click", async () => {
    const ok = await confirmDialog("이 현장과 관련 점검 기록을 모두 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteSite(currentSiteId);
    renderSites();
    showScreen("screen-sites");
  });

  // ================= 점검 목록 (거래처 상세의 날짜별 점검 탭) =================
  function computeStatus(insp) {
    if (insp.status === "completed") return "completed";
    if (insp.scheduledDate && insp.scheduledDate < todayISO()) return "overdue";
    return "scheduled";
  }

  const STATUS_LABEL = { scheduled: "예정", overdue: "기한초과", completed: "완료" };

  function inspectionCardHtml(insp, site) {
    const st = computeStatus(insp);
    const typeLabel = inspectionTypeForMonth(site, insp.scheduledDate);
    return `
      <div class="list-card" data-id="${insp.id}">
        <div class="list-card-title">
          <span class="list-card-title-main">${escapeHtml(insp.scheduledDate || "")}</span>
          <span class="list-card-title-right">
            <span class="badge badge-${st}">${STATUS_LABEL[st]}</span>
            <button type="button" class="list-card-menu-btn" data-menu-btn>⋯</button>
          </span>
        </div>
        <div class="site-card-menu hidden" data-menu>
          <button type="button" data-menu-edit>수정하기</button>
          <button type="button" class="danger" data-menu-delete>삭제</button>
        </div>
        <div class="list-card-sub">${escapeHtml(typeLabel)}${insp.inspector ? " · 점검자: " + escapeHtml(insp.inspector) : ""}</div>
      </div>
    `;
  }

  // 점검 이력 목록에서 날짜 하나를 눌렀을 때: 그 회차의 정보와 사진(업로드/열람)을 한 화면에서 보여준다 -
  // 예전엔 "현장점검 사진" 버튼을 눌러야 별도 갤러리 화면으로 넘어갔는데, 그 한 단계를 없애고 이 화면
  // 안에서 바로 사진을 올리고 볼 수 있게 합친 것(사용자 요청, 2026-08-24).
  async function openInspectionDetail(inspId) {
    const insp = await FireDB.getInspection(inspId);
    if (!insp) { openSiteDetail(currentSiteId); return; }
    currentInspectionId = inspId;
    currentSiteId = insp.siteId;
    galleryActiveInspectionId = inspId;
    gallerySelected = new Set();
    const site = await FireDB.getSite(insp.siteId);
    const st = computeStatus(insp);
    $("#inspectionDetailInfo").innerHTML = `
      <h2>${escapeHtml(site ? site.name : "")}</h2>
      <div class="report-meta-row"><span class="label">날짜</span><span>${escapeHtml(insp.scheduledDate || "")}</span></div>
      <div class="report-meta-row"><span class="label">종류</span><span>${escapeHtml(inspectionTypeForMonth(site, insp.scheduledDate))}</span></div>
      <div class="report-meta-row"><span class="label">상태</span><span class="badge badge-${st}">${STATUS_LABEL[st]}</span></div>
    `;
    await loadGalleryPhotos();
    showScreen("screen-inspection-detail");
  }

  $("#btnBackFromInspectionDetail").addEventListener("click", () => openSiteDetail(currentSiteId));

  // ================= 사진 갤러리 (점검 회차별 현장점검 사진 - 점검 상세 화면 안에 포함) =================
  let galleryActiveInspectionId = null; // 현재 화면이 속한 점검 회차 id - 사진은 이 id로 귀속되고, "방문 완료 처리"도 이 회차를 대상으로 함
  let galleryPhotos = [];              // [{id, blob, createdAt, ...}]
  let gallerySelected = new Set();
  let galleryViewerIndex = -1;

  async function loadGalleryPhotos() {
    const all = await FireDB.getPhotosByInspection(galleryActiveInspectionId);
    const photoMap = new Map(all.map((p) => [p.id, p]));
    await fillMissingInspectionPhotosFromDrive(galleryActiveInspectionId, photoMap);

    // 다른 기기에서 삭제한 사진은 이 기기에도 반영되도록 - 점검 회차의 공유 목록(photoIds)에
    // 없는 사진은 로컬에서도 지운다. photoIds 자체가 한 번도 기록된 적 없는(undefined) 회차는
    // 이 기능이 생기기 전부터 있던 사진들이라 "없다"는 게 삭제된 건지 애초에 추적 대상이 아니었던
    // 건지 구분할 수 없으므로 손대지 않는다(예전 사진을 실수로 지우지 않기 위한 안전장치).
    const insp = await FireDB.getInspection(galleryActiveInspectionId);
    if (insp && Array.isArray(insp.photoIds)) {
      const validIds = new Set(insp.photoIds);
      for (const id of Array.from(photoMap.keys())) {
        if (!validIds.has(id)) {
          photoMap.delete(id);
          await FireDB.deletePhoto(id).catch(() => {});
        }
      }
    }

    galleryPhotos = Array.from(photoMap.values()).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    gallerySelected = new Set(Array.from(gallerySelected).filter((id) => galleryPhotos.some((p) => p.id === id)));
    renderGalleryGrid();
  }

  function renderGalleryGrid() {
    revokeObjectUrls();
    const grid = $("#galleryGrid");
    if (galleryPhotos.length === 0) {
      grid.innerHTML = `<div class="empty-state">등록된 사진이 없습니다.</div>`;
    } else {
      grid.innerHTML = galleryPhotos.map((p) => {
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        const selected = gallerySelected.has(p.id);
        return `
          <div class="gallery-thumb-wrap ${selected ? "selected" : ""}" data-id="${p.id}">
            <img class="gallery-thumb" src="${url}">
            <span class="gallery-thumb-check" data-id="${p.id}">${selected ? "✓" : ""}</span>
          </div>
        `;
      }).join("");
    }
    $$("#galleryGrid .gallery-thumb").forEach((img) => {
      img.addEventListener("click", () => openPhotoViewer(img.closest(".gallery-thumb-wrap").dataset.id));
    });
    $$("#galleryGrid .gallery-thumb-check").forEach((chk) => {
      chk.addEventListener("click", (e) => { e.stopPropagation(); toggleGallerySelect(chk.dataset.id); });
    });
    updateGalleryToolbar();
  }

  function toggleGallerySelect(id) {
    if (gallerySelected.has(id)) gallerySelected.delete(id); else gallerySelected.add(id);
    renderGalleryGrid();
  }

  function updateGalleryToolbar() {
    const allSelected = galleryPhotos.length > 0 && gallerySelected.size === galleryPhotos.length;
    $("#btnGallerySelectAll").textContent = allSelected ? "선택 해제" : "전체 선택";
    $("#btnGallerySelectAll").disabled = galleryPhotos.length === 0;
    $("#btnGalleryShare").disabled = gallerySelected.size === 0;
    $("#btnGalleryShare").textContent = gallerySelected.size > 0 ? `선택한 사진 공유 (${gallerySelected.size})` : "선택한 사진 공유";
  }

  $("#btnGallerySelectAll").addEventListener("click", () => {
    gallerySelected = gallerySelected.size === galleryPhotos.length ? new Set() : new Set(galleryPhotos.map((p) => p.id));
    renderGalleryGrid();
  });

  $("#btnGalleryUpload").addEventListener("click", () => $("#galleryUploadInput").click());

  $("#galleryUploadInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    ImportLoading.show("사진을 저장하고 있습니다.");
    try {
      let idx = 0;
      const newIds = [];
      for (const file of files) {
        idx++;
        ImportLoading.setProgress((idx / files.length) * 100, files.length > 1 ? `사진을 저장하고 있습니다. (${idx}/${files.length})` : "사진을 저장하고 있습니다.");
        const uploadFile = await compressPhotoForUpload(file);
        const photo = await FireDB.addPhoto({
          siteId: currentSiteId,
          inspectionId: galleryActiveInspectionId,
          blob: uploadFile,
          createdAt: new Date().toISOString()
        });
        await backupToDrive(currentSiteId, "현장점검_사진", `${photo.id}.jpg`, uploadFile);
        newIds.push(photo.id);
      }
      // 다른 사람/기기에서도 이 사진들이 보이도록, 점검 회차(공유 데이터)에 사진 id 목록을 남긴다 -
      // 사진 원본은 기기별 로컬 저장이라 이 목록이 없으면 다른 기기는 구글 드라이브에서 무엇을
      // 찾아와야 할지 알 방법이 없다(사용자가 겪은 문제: "다른 사람이 올린 사진이 안 보임").
      if (newIds.length) {
        const insp = await FireDB.getInspection(galleryActiveInspectionId);
        if (insp) {
          const photoIds = Array.from(new Set([...(insp.photoIds || []), ...newIds]));
          await FireDB.updateInspection(galleryActiveInspectionId, { photoIds, photoSyncEnabled: true });
        }
      }
    } finally {
      ImportLoading.hide();
    }
    await loadGalleryPhotos();
    toast(`${files.length}장의 사진을 추가했습니다.`, "success");
  });

  function galleryPhotoFilename(p, idx) {
    const ext = p.blob.type && p.blob.type.includes("png") ? "png" : "jpg";
    return `사진${idx + 1}_${(p.createdAt || "").slice(0, 10)}.${ext}`;
  }

  async function shareOrDownloadFiles(files, title) {
    if (isNativeApp()) {
      try {
        await nativeShareFiles(files.map((f) => ({ blob: f, name: f.name })), title);
        return;
      } catch (e) {
        if (e && e.message && /cancel/i.test(e.message)) return; // 사용자가 공유 화면에서 취소함
        toast("공유 화면을 여는 데 실패했습니다: " + (e && e.message ? e.message : "알 수 없는 오류"), "error");
        return;
      }
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    toast(`${files.length}장의 사진이 다운로드되었습니다. 원하는 방법으로 공유해주세요.`, "success");
  }

  $("#btnGalleryShare").addEventListener("click", async () => {
    const selectedPhotos = galleryPhotos.filter((p) => gallerySelected.has(p.id));
    if (selectedPhotos.length === 0) return;
    const files = selectedPhotos.map((p, i) => new File([p.blob], galleryPhotoFilename(p, i), { type: p.blob.type || "image/jpeg" }));
    await shareOrDownloadFiles(files, "현장점검 사진");
  });

  function openPhotoViewer(photoId) {
    galleryViewerIndex = galleryPhotos.findIndex((p) => p.id === photoId);
    if (galleryViewerIndex === -1) return;
    renderPhotoViewer();
    $("#photoViewerModal").classList.remove("hidden");
  }

  function renderPhotoViewer() {
    const p = galleryPhotos[galleryViewerIndex];
    if (!p) { closePhotoViewer(); return; }
    const url = URL.createObjectURL(p.blob);
    activeObjectUrls.push(url);
    $("#photoViewerImg").src = url;
    $("#btnPhotoViewerPrev").disabled = galleryViewerIndex <= 0;
    $("#btnPhotoViewerNext").disabled = galleryViewerIndex >= galleryPhotos.length - 1;
    $("#btnDeleteViewerPhoto").classList.remove("hidden");
  }

  function closePhotoViewer() {
    $("#photoViewerModal").classList.add("hidden");
    galleryViewerIndex = -1;
  }

  $("#btnClosePhotoViewer").addEventListener("click", closePhotoViewer);
  $("#photoViewerModal").addEventListener("click", (e) => {
    if (e.target.id === "photoViewerModal") closePhotoViewer();
  });
  $("#btnPhotoViewerPrev").addEventListener("click", () => {
    if (galleryViewerIndex > 0) { galleryViewerIndex--; renderPhotoViewer(); }
  });
  $("#btnPhotoViewerNext").addEventListener("click", () => {
    if (galleryViewerIndex < galleryPhotos.length - 1) { galleryViewerIndex++; renderPhotoViewer(); }
  });
  $("#btnDeleteViewerPhoto").addEventListener("click", async () => {
    const p = galleryPhotos[galleryViewerIndex];
    if (!p) return;
    const ok = await confirmDialog("이 사진을 삭제할까요?");
    if (!ok) return;
    await FireDB.deletePhoto(p.id);
    gallerySelected.delete(p.id);
    closePhotoViewer();
    // 남은 사진 id 목록을 항상 공유 데이터(photoIds)에 다시 써준다 - 이 회차가 photoIds를
    // 아직 한 번도 기록한 적 없어도(이 기능이 생기기 전부터 있던 사진이라도) 지금 이 기기가
    // 알고 있는 실제 남은 목록으로 채워서, 이후로는 다른 기기가 이미 내려받아 갖고 있던
    // 사본도 다음에 열 때 loadGalleryPhotos의 정리 로직으로 같이 지워지게 한다.
    const remaining = galleryPhotos.filter((ph) => ph.id !== p.id).map((ph) => ph.id);
    await FireDB.updateInspection(galleryActiveInspectionId, { photoIds: remaining, photoSyncEnabled: true });
    await loadGalleryPhotos();
  });

  $("#btnCompleteSiteVisit").addEventListener("click", async () => {
    const ok = await confirmDialog("오늘 점검을 완료 처리할까요? (마지막 점검일이 갱신됩니다)");
    if (!ok || !galleryActiveInspectionId) return;
    const insp = await FireDB.getInspection(galleryActiveInspectionId);
    const completedDate = todayISO();
    await FireDB.updateInspection(galleryActiveInspectionId, { status: "completed", completedDate });
    if (insp) {
      // 예정일(scheduledDate)이 아니라 실제로 "점검 완료 처리"를 누른 날짜(completedDate)로
      // 회차를 만든다 - 예정일과 다른 날 완료 처리했을 때 지적사항 메뉴의 회차 날짜가 실제
      // 방문일과 어긋나던 문제 수정(사용자 요청).
      await ensureDeficiencyRoundForDate(insp.siteId, completedDate);
      await ensureConstructionJobForDate(insp.siteId, completedDate);
    }
    toast("점검이 완료 처리되었습니다.", "success");
    await openInspectionDetail(galleryActiveInspectionId);
  });

  // ================= 지적사항 / 이행완료 (점검 기록과 완전히 분리, 현장에만 귀속) =================
  // 지적사항은 "회차"(deficiencyRounds) 단위로 묶인다 - 업체 하나를 여러 날짜에 방문할 때마다
  // 방문 날짜별로 독립된 지적사항 묶음(=그 날짜의 이행완료보고서)이 남아, 나중에 업체를 클릭하면
  // 날짜별 목록이 보이고 어느 것이든 다시 열어 수정할 수 있다(사용자 요청, 2026-08-22). 회차는
  // 점검(inspections)과는 별개의 가벼운 개념이다 - "점검이 먼저 있어야 지적사항을 추가할 수 있다"는
  // 예전 마찰(2026-08-11에 지적사항을 점검에서 완전히 분리했던 이유)을 되풀이하지 않기 위함.
  let currentDeficiencySiteId = null;
  let currentRoundId = null;
  let currentDeficiencies = [];

  function findDeficiency(defId) {
    return currentDeficiencies.find((d) => d.id === defId);
  }

  function newDeficiency(fields) {
    return {
      id: FireDB.genId(),
      siteId: fields.siteId || currentDeficiencySiteId,
      roundId: fields.roundId || currentRoundId,
      category: fields.category || "",
      floor: fields.floor || "",
      location: fields.location || "",
      code: normalizeInspectionCode(fields.code || ""),
      description: fields.description || "",
      beforePhotoIds: [],
      afterPhotoIds: [],
      resolved: false,
      createdAt: new Date().toISOString()
    };
  }

  // ---------- 지적사항 허브 (현장별) ----------
  // ================= 보고서 모아보기 =================
  // 이행완료보고서는 로컬에 따로 저장되지 않고 생성될 때마다 구글 드라이브(현장별 "이행완료보고서"
  // 폴더)로 백업되므로, 그 드라이브가 그대로 "지금까지 만든 보고서" 목록의 원본이다 - 프록시의
  // list-reports가 모든 현장 폴더를 돌며 모아준다.
  async function renderReportsHub() {
    const list = $("#reportsHubList");
    list.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
    let files;
    try {
      files = await DriveBackup.listReports();
    } catch (err) {
      list.innerHTML = `<div class="empty-state">보고서 목록을 불러오지 못했습니다.<br>네트워크를 확인해주세요.</div>`;
      return;
    }
    if (files.length === 0) {
      list.innerHTML = `<div class="empty-state">아직 생성된 이행완료보고서가 없습니다.</div>`;
      return;
    }
    list.innerHTML = files.map((f) => `
      <div class="report-row" data-id="${f.id}" data-name="${escapeHtml(f.name)}">
        <span class="report-row-site">${escapeHtml(f.siteName)}</span>
        <span class="report-row-file">${escapeHtml(f.name)}</span>
      </div>
    `).join("");
    $$("#reportsHubList .report-row").forEach((el) => {
      el.addEventListener("click", async () => {
        if (el.classList.contains("report-row-loading")) return;
        el.classList.add("report-row-loading");
        try {
          const blob = await DriveBackup.downloadFile(el.dataset.id);
          const name = el.dataset.name;
          const mimeType = name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/hwp+zip";
          await shareOrDownloadFile(blob, name, mimeType);
        } catch (err) {
          toast("파일을 여는 데 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
        } finally {
          el.classList.remove("report-row-loading");
        }
      });
    });
  }

  // 지적사항이 하나도 없는 현장은 "확인해봤는데 정말 없음"(최신 회차의 noDeficiency로 명시적으로
  // 표시함)과 "신규 등록이라 아직 확인 전"을 구분한다 - 둘 다 그냥 "지적사항 없음"이라고
  // 하면 아직 검토 안 한 신규 거래처도 이미 확인 끝난 것처럼 보여서 놓치기 쉽다.
  function deficiencySiteStatuses(c, s) {
    const statuses = [];
    if (c.open > 0) statuses.push("open");
    if (c.resolved > 0) statuses.push("resolved");
    if (c.open === 0 && c.resolved === 0) statuses.push(c.noDeficiency ? "none" : "pending");
    return statuses;
  }

  // 회차(날짜) 하나의 지적사항 진행 상태를 검토중/미해결/해결/지적사항 없음 중 하나로 나타낸다
  // (사용자 요청) - 지적사항이 등록되지 않았으면 검토중, 미해결 항목이 하나라도 있으면 미해결,
  // 전부 이행완료됐으면 해결, "지적사항 없음"으로 표시해둔 회차면 지적사항 없음. 지적사항 허브의
  // 업체 배지와 회차 목록의 날짜별 배지가 같은 기준을 쓰도록 공용 함수로 뺐다.
  function roundStatusBadge(round, openCount, resolvedCount) {
    if (round && round.noDeficiency) return { label: "지적사항 없음", cls: "badge-scheduled" };
    if (openCount > 0) return { label: "미해결", cls: "badge-open" };
    if (resolvedCount > 0) return { label: "해결", cls: "badge-resolved" };
    return { label: "검토중", cls: "badge-pending" };
  }

  function deficiencyHubCardHtml(s, c) {
    // 업체 배지는 미해결/해결을 같이 보여주지 않고 최신 회차 기준 단일 상태 하나만 보여준다
    // (사용자 요청) - 미해결이 하나라도 있으면 그게 우선.
    const status = roundStatusBadge({ noDeficiency: c.noDeficiency }, c.open, c.resolved);
    const badges = `<span class="badge ${status.cls}">${status.label}</span>`;
    return `
      <div class="list-card" data-site="${s.id}">
        <div class="list-card-title">
          <span class="list-card-title-main">${escapeHtml(s.name)}</span>
          <span class="list-card-title-right">
            <span class="list-card-badges">${badges}</span>
            <button type="button" class="list-card-menu-btn" data-menu-btn>⋯</button>
          </span>
        </div>
        <div class="site-card-menu hidden" data-menu>
          <button type="button" data-menu-edit>수정</button>
          <button type="button" class="danger" data-menu-delete>삭제</button>
        </div>
        <div class="list-card-sub">${escapeHtml(s.address || "")}</div>
      </div>
    `;
  }

  function bindDeficiencyHubCardClicks(container) {
    Array.from(container.querySelectorAll(".list-card")).forEach((el) => {
      const id = el.dataset.site;
      el.addEventListener("click", () => openSiteRounds(id));
      const menuBtn = el.querySelector("[data-menu-btn]");
      const menu = el.querySelector("[data-menu]");
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = menu === openSiteCardMenu;
        closeSiteCardMenu();
        if (!wasOpen) { menu.classList.remove("hidden"); openSiteCardMenu = menu; }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.querySelector("[data-menu-edit]").addEventListener("click", () => {
        closeSiteCardMenu();
        openSiteEditForm(id);
      });
      menu.querySelector("[data-menu-delete]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const ok = await confirmDialog("거래처를 삭제 하시겠습니까?");
        if (!ok) return;
        await FireDB.deleteSite(id);
        renderDeficiencyHub();
      });
    });
  }

  function renderDeficiencyHubByRegion(sites, countsBySite) {
    const list = $("#deficiencyHubList");
    if (defSelectedRegion) {
      const inRegion = sites.filter((s) => classifyRegion(s.address) === defSelectedRegion);
      const backBtnHtml = `<button class="btn btn-secondary region-back-row" id="btnDefBackToRegionList">← 지역 목록으로 (${escapeHtml(defSelectedRegion)})</button>`;
      if (inRegion.length === 0) {
        list.innerHTML = `${backBtnHtml}<div class="empty-state">이 지역에 해당하는 거래처가 없습니다.</div>`;
      } else {
        list.innerHTML = backBtnHtml + inRegion.map((s) => deficiencyHubCardHtml(s, countsBySite.get(s.id) || { open: 0, resolved: 0 })).join("");
        bindDeficiencyHubCardClicks(list);
      }
      $("#btnDefBackToRegionList").addEventListener("click", () => { defSelectedRegion = null; renderDeficiencyHub(); });
      return;
    }
    const counts = new Map();
    sites.forEach((s) => {
      const region = classifyRegion(s.address);
      counts.set(region, (counts.get(region) || 0) + 1);
    });
    const daeguOrder = DAEGU_DISTRICTS.filter((g) => counts.has(g));
    const otherOrder = PROVINCE_PATTERNS.map(([, label]) => label).filter((l) => l !== "대구" && counts.has(l));
    const orderedRegions = [...daeguOrder, ...otherOrder];
    if (counts.has("대구 기타")) orderedRegions.push("대구 기타");
    if (counts.has("지역 미상")) orderedRegions.push("지역 미상");

    list.innerHTML = `<div class="region-grid">${orderedRegions.map((r) => `
      <button class="region-btn" data-region="${escapeHtml(r)}">
        <span class="region-btn-name">${escapeHtml(r)}</span>
        <span class="region-btn-count">${counts.get(r)}개</span>
      </button>
    `).join("")}</div>`;
    Array.from(list.querySelectorAll(".region-btn")).forEach((btn) => {
      btn.addEventListener("click", () => { defSelectedRegion = btn.dataset.region; renderDeficiencyHub(); });
    });
  }

  // 업체 카드의 미해결/해결 배지는 방문 회차가 여러 개여도 전체를 합산하지 않고, 가장 최근 회차
  // (날짜 기준)만 반영한다(사용자 요청, 2026-08-22 - "옛날 방문 결과까지 다 더해서 보이면 지금
  // 상태를 바로 알기 어렵다"는 취지). 아직 회차로 마이그레이션되지 않은 옛 지적사항(roundId 없음)만
  // 있는 업체는 그 전체를 하나의 암묵적 회차로 보고 그대로 합산한다 - 회차 화면을 한 번도 열어보지
  // 않은 업체의 배지가 갑자기 "0건"으로 비어 보이는 회귀를 막기 위함.
  function latestRoundCountsBySite(sites, defs, rounds) {
    const roundsBySite = new Map();
    rounds.forEach((r) => {
      const arr = roundsBySite.get(r.siteId) || [];
      arr.push(r);
      roundsBySite.set(r.siteId, arr);
    });
    const countsBySite = new Map();
    sites.forEach((s) => {
      const siteRounds = roundsBySite.get(s.id) || [];
      let latestRound = null;
      if (siteRounds.length > 0) {
        siteRounds.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        latestRound = siteRounds[0];
      }
      const latestRoundId = latestRound ? latestRound.id : null;
      const c = { open: 0, resolved: 0 };
      defs.forEach((d) => {
        if (d.siteId !== s.id) return;
        const inLatest = latestRoundId ? d.roundId === latestRoundId : !d.roundId;
        if (!inLatest) return;
        d.resolved ? c.resolved++ : c.open++;
      });
      // "지적사항 없음"은 회차마다 따로 기록된다(round.noDeficiency) - 회차가 하나도 없는
      // 옛 현장(레거시)만 예외적으로 site.deficiencyReviewed를 그대로 본다.
      c.noDeficiency = latestRound ? !!latestRound.noDeficiency : !!s.deficiencyReviewed;
      // "최신순" 정렬(점검완료일 기준)에 쓸 마지막 회차 날짜 - 회차가 없으면 null(정렬 시 맨 뒤로).
      c.date = latestRound ? latestRound.date : null;
      countsBySite.set(s.id, c);
    });
    return countsBySite;
  }

  // "이번달"/"다음달"/"지난달" 버튼이 가리키는 실제 달(1~12) - 오늘 기준으로 계산한다.
  function defTargetMonth() {
    const cur = new Date().getMonth() + 1;
    if (defMonthFilter === "next") return cur === 12 ? 1 : cur + 1;
    if (defMonthFilter === "last") return cur === 1 ? 12 : cur - 1;
    return cur; // "this"
  }

  async function renderDeficiencyHub() {
    $("#btnDefSortByName").classList.toggle("active", defSortMode === "name" && !defMonthFilter);
    $("#btnDefSortByRegion").classList.toggle("active", defSortMode === "region" && !defMonthFilter);
    $("#btnDefSortByRecent").classList.toggle("active", defSortMode === "recent" && !defMonthFilter);
    $("#btnDefFilterThisMonth").classList.toggle("active", defMonthFilter === "this");
    $("#btnDefFilterNextMonth").classList.toggle("active", defMonthFilter === "next");
    $("#btnDefFilterLastMonth").classList.toggle("active", defMonthFilter === "last");

    const [sites, defs, rounds] = await Promise.all([FireDB.getAllSites(), FireDB.getAllDeficiencies(), FireDB.getAllRounds()]);
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const countsBySite = latestRoundCountsBySite(sites, defs, rounds);
    const list = $("#deficiencyHubList");
    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 현장이 없습니다.</div>`;
      return;
    }

    let filtered = defFilters.size === 0
      ? sites
      : sites.filter((s) => {
        const c = countsBySite.get(s.id) || { open: 0, resolved: 0 };
        return deficiencySiteStatuses(c, s).some((st) => defFilters.has(st));
      });

    // "이번달"/"다음달"/"지난달"은 종합/작동점검월이 그 달에 해당하는 거래처만 남긴다(사용자 요청).
    if (defMonthFilter) {
      const month = defTargetMonth();
      filtered = filtered.filter((s) => isSiteInMonth(s, month));
    }

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state">선택한 조건에 맞는 거래처가 없습니다.</div>`;
      return;
    }

    // 월 필터가 켜져 있으면 그에 맞는 정렬을 강제한다(사용자 요청) - 이번달→최신순, 다음달/지난달→가나다순.
    const effectiveSortMode = !defMonthFilter ? defSortMode : (defMonthFilter === "this" ? "recent" : "name");

    if (effectiveSortMode === "recent") {
      // 점검완료일(최근 회차 날짜) 기준 최신순 - 날짜가 없는 거래처는 맨 뒤로 보낸다.
      filtered = [...filtered].sort((a, b) => {
        const da = (countsBySite.get(a.id) || {}).date || "";
        const db = (countsBySite.get(b.id) || {}).date || "";
        return db.localeCompare(da);
      });
    }

    if (effectiveSortMode === "region") {
      renderDeficiencyHubByRegion(filtered, countsBySite);
      return;
    }
    list.innerHTML = filtered.map((s) => deficiencyHubCardHtml(s, countsBySite.get(s.id) || { open: 0, resolved: 0 })).join("");
    bindDeficiencyHubCardClicks(list);
  }

  $("#btnDefSortByName").addEventListener("click", () => {
    defSortMode = "name";
    defSelectedRegion = null;
    defMonthFilter = null;
    renderDeficiencyHub();
  });
  $("#btnDefSortByRegion").addEventListener("click", () => {
    defSortMode = "region";
    defMonthFilter = null;
    renderDeficiencyHub();
  });
  $("#btnDefSortByRecent").addEventListener("click", () => {
    defSortMode = "recent";
    defSelectedRegion = null;
    defMonthFilter = null;
    renderDeficiencyHub();
  });
  // "이번달"/"다음달"/"지난달"은 서로 배타적인 토글 버튼 - 켜져 있는 걸 다시 누르면 꺼진다(전체 보기로 복귀).
  function wireDefMonthButton(id, key) {
    $("#" + id).addEventListener("click", () => {
      defMonthFilter = defMonthFilter === key ? null : key;
      defSelectedRegion = null;
      renderDeficiencyHub();
    });
  }
  wireDefMonthButton("btnDefFilterThisMonth", "this");
  wireDefMonthButton("btnDefFilterNextMonth", "next");
  wireDefMonthButton("btnDefFilterLastMonth", "last");
  $$("#defFilterToolbar .filter-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.filter;
      if (defFilters.has(key)) { defFilters.delete(key); btn.classList.remove("active"); }
      else { defFilters.add(key); btn.classList.add("active"); }
      defSelectedRegion = null;
      renderDeficiencyHub();
    });
  });

  // 회차 도입 전(2026-08-22 이전)에 만들어진 지적사항은 roundId가 아예 없다 - 그런 현장을 처음
  // 열 때 딱 한 번, 그 기존 지적사항 전체를 회차 하나로 묶어준다(가장 이른 생성일을 회차 날짜로
  // 사용). 이미 회차가 하나라도 있으면 마이그레이션할 게 없으므로 그냥 통과.
  async function ensureRoundsForSite(siteId) {
    const rounds = await FireDB.getRoundsBySite(siteId);
    if (rounds.length > 0) return rounds;
    const legacyDefs = (await FireDB.getDeficienciesBySite(siteId)).filter((d) => !d.roundId);
    if (legacyDefs.length === 0) return rounds;
    legacyDefs.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const date = (legacyDefs[0].createdAt || new Date().toISOString()).slice(0, 10);
    const round = await FireDB.addRound({ siteId, date, label: "", createdAt: new Date().toISOString() });
    for (const def of legacyDefs) {
      await FireDB.updateDeficiency(def.id, { roundId: round.id });
    }
    return [round];
  }

  // 거래처 상세에서 "방문 완료 처리"를 누른 날짜를, 지적사항 메뉴에도 같은 날짜의 회차로 자동
  // 만들어준다(사용자 요청) - 방문을 마쳤으면 보통 그 자리에서 지적사항도 확인하므로, "+ 새 점검
  // 회차 시작"으로 같은 날짜를 또 골라야 하는 수고를 없앤다. 그 날짜의 회차가 이미 있으면(예:
  // 지적사항 메뉴에서 먼저 만들어둔 경우) 중복 생성하지 않고 그대로 둔다.
  async function ensureDeficiencyRoundForDate(siteId, date) {
    if (!date) return;
    const rounds = await FireDB.getRoundsBySite(siteId);
    if (rounds.some((r) => r.date === date)) return;
    await FireDB.addRound({ siteId, date, label: "", createdAt: new Date().toISOString() });
  }

  // "점검 완료 처리"를 누르면 그 날짜만 공사팀에도 자동으로 넘겨준다(사용자 요청) - 점검팀
  // 기록을 그대로 복사하는 게 아니라 날짜 하나만 공사팀 저장소(constructionJobs)에 새로 만들어,
  // 그 뒤 내용은 공사팀이 독립적으로 채운다. 같은 날짜가 이미 있으면 중복 생성하지 않는다.
  async function ensureConstructionJobForDate(siteId, date) {
    if (!date) return;
    const jobs = await FireDB.getConstructionJobsBySite(siteId);
    if (jobs.some((j) => j.date === date)) return;
    await FireDB.addConstructionJob({ siteId, date, memo: "", createdAt: new Date().toISOString() });
  }

  async function openSiteRounds(siteId) {
    currentDeficiencySiteId = siteId;
    await ensureRoundsForSite(siteId);
    await renderDeficiencyRounds();
    showScreen("screen-deficiency-rounds");
  }

  async function renderDeficiencyRounds() {
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const rounds = await FireDB.getRoundsBySite(currentDeficiencySiteId);
    rounds.sort((a, b) => (b.date || "").localeCompare(a.date || "")); // 최근 방문이 위로

    $("#deficiencyRoundsHeader").innerHTML = `
      <h2>${escapeHtml(site ? site.name : "")} · 지적사항 회차</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site && site.address ? site.address : "-")}</span></div>
    `;
    // "모든 지적 내역 삭제"는 회차 안에 지운 지적사항이 있어야 의미가 있으므로, 등록된 회차가
    // 하나도 없으면(=지울 게 없으면) 숨긴다.
    $("#btnDeleteAllSiteDeficiencies").classList.toggle("hidden", rounds.length === 0);

    const list = $("#deficiencyRoundsList");
    if (rounds.length === 0) {
      list.innerHTML = `<div class="empty-state">${site && site.deficiencyReviewed
        ? "지적사항 없음으로 확인된 현장입니다."
        : "아직 등록된 점검 회차가 없습니다.<br>'+ 새 점검 회차 시작'으로 시작해보세요."}</div>`;
      return;
    }

    // 날짜(요일) 옆 배지는 그 날짜의 점검 완료 여부(예정/완료)가 아니라 그 회차에 등록된
    // 지적사항 상태(검토중/미해결/해결/지적사항 없음)를 보여준다(사용자 요청) - roundStatusBadge
    // 참고, 지적사항 허브의 업체 배지와 같은 기준.
    const siteDefs = await FireDB.getDeficienciesBySite(currentDeficiencySiteId);
    const defsByRound = new Map();
    siteDefs.forEach((d) => {
      const arr = defsByRound.get(d.roundId) || [];
      arr.push(d);
      defsByRound.set(d.roundId, arr);
    });
    // "점검완료 처리"로 자동 생성된 회차에만 종합/작동 표시를 붙인다(사용자 요청) - "+ 등록"으로
    // 수동으로 만든 회차는 실제 법정 점검(종합/작동) 방문이 아닐 수 있어 표시하지 않는다. 그
    // 회차 날짜에 완료된 점검이 실제로 있는지로 구분한다(round.date를 나중에 수정해도 그
    // 시점 기준으로 다시 판단되도록 플래그 대신 매번 조회).
    const siteInspections = await FireDB.getInspectionsBySite(currentDeficiencySiteId);
    const completedInspectionDates = new Set();
    siteInspections.forEach((insp) => {
      if (insp.status !== "completed") return;
      if (insp.scheduledDate) completedInspectionDates.add(insp.scheduledDate);
      if (insp.completedDate) completedInspectionDates.add(insp.completedDate);
    });
    function roundCardHtml(r) {
      const d = r.date ? new Date(r.date + "T00:00:00") : null;
      const dateLabel = d && !isNaN(d) ? `${r.date} (${WEEKDAY_LABEL[d.getDay()]})` : (r.date || "");
      const roundDefs = defsByRound.get(r.id) || [];
      const open = roundDefs.filter((x) => !x.resolved).length;
      const resolved = roundDefs.filter((x) => x.resolved).length;
      const status = roundStatusBadge(r, open, resolved);
      const typeLabel = completedInspectionDates.has(r.date) ? inspectionTypeForMonth(site, r.date) : "";
      return `
        <div class="list-card" data-round="${r.id}">
          <div class="list-card-title">
            <span class="list-card-title-main">${escapeHtml(dateLabel)}</span>
            <span class="list-card-title-right">
              ${typeLabel ? `<span class="badge badge-neutral">${escapeHtml(typeLabel)}</span>` : ""}
              <span class="badge ${status.cls}">${status.label}</span>
              <button type="button" class="list-card-menu-btn" data-menu-btn>⋯</button>
            </span>
          </div>
          <div class="site-card-menu hidden" data-menu>
            <button type="button" data-menu-edit-date>날짜 수정</button>
            <button type="button" class="danger" data-menu-delete>삭제</button>
          </div>
        </div>
      `;
    }

    list.innerHTML = groupConsecutiveByDate(rounds, (r) => r.date).map((group) => {
      if (group.length < 2) return roundCardHtml(group[0]);
      const endDate = group[0].date;
      const startDate = group[group.length - 1].date;
      return `
        <div class="date-group">
          <div class="date-group-header">${escapeHtml(startDate)} ~ ${escapeHtml(endDate)} (${group.length}일간)</div>
          ${group.map(roundCardHtml).join("")}
        </div>
      `;
    }).join("");

    Array.from(list.querySelectorAll(".list-card")).forEach((el) => {
      const roundId = el.dataset.round;
      el.addEventListener("click", () => openRoundDeficiencies(currentDeficiencySiteId, roundId));
      const menuBtn = el.querySelector("[data-menu-btn]");
      const menu = el.querySelector("[data-menu]");
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = menu === openSiteCardMenu;
        closeSiteCardMenu();
        if (!wasOpen) { menu.classList.remove("hidden"); openSiteCardMenu = menu; }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.querySelector("[data-menu-edit-date]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const round = rounds.find((r) => r.id === roundId);
        const newDate = await promptDate("점검 날짜 수정", round.date);
        if (!newDate) return;
        await FireDB.updateRound(roundId, { date: newDate });
        await renderDeficiencyRounds();
      });
      menu.querySelector("[data-menu-delete]").addEventListener("click", async () => {
        closeSiteCardMenu();
        const ok = await confirmDialog("이 점검 회차와 등록된 모든 지적사항을 삭제할까요? 이 작업은 되돌릴 수 없습니다.");
        if (!ok) return;
        await FireDB.deleteRound(roundId);
        await renderDeficiencyRounds();
      });
    });
  }

  $("#btnAddRound").addEventListener("click", async () => {
    const date = await promptDate("새 점검 회차 날짜", todayISO());
    if (!date) return;
    const round = await FireDB.addRound({ siteId: currentDeficiencySiteId, date, label: "", createdAt: new Date().toISOString() });
    await openRoundDeficiencies(currentDeficiencySiteId, round.id);
    // 새 회차를 시작한 김에 바로 자료를 올릴 수 있도록 업로드 창을 띄운다 - "지적사항 자료
    // 올리기" 버튼(btnImportData)을 또 눌러야 하는 수고를 줄이기 위함. 취소하면 그냥 빈 회차만 남는다.
    $("#fileUploadModal").classList.remove("hidden");
  });

  $("#btnBackFromRounds").addEventListener("click", async () => {
    await renderDeficiencyHub();
    showScreen("screen-deficiency-hub");
  });

  async function openRoundDeficiencies(siteId, roundId) {
    currentDeficiencySiteId = siteId;
    currentRoundId = roundId;
    currentDeficiencies = await FireDB.getDeficienciesByRound(roundId);
    currentDeficiencies.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    await renderDeficiencies();
    showScreen("screen-deficiencies");
  }

  // ---------- 지적사항 목록/편집 (현장 단위) ----------
  async function renderDeficiencies() {
    revokeObjectUrls();
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const round = await FireDB.getRound(currentRoundId);
    const open = currentDeficiencies.filter((d) => !d.resolved).length;
    const resolved = currentDeficiencies.filter((d) => d.resolved).length;
    $("#deficiencyHeader").innerHTML = `
      <h2>${escapeHtml(site ? site.name : "")} · 지적사항 관리</h2>
      <div class="report-meta-row"><span class="label">점검 날짜</span><span>${escapeHtml(round ? round.date : "-")}${round && round.label ? ` (${escapeHtml(round.label)})` : ""}</span></div>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site && site.address ? site.address : "-")}</span></div>
      <div class="report-meta-row"><span class="label">미해결 / 해결</span><span>${open}건 / ${resolved}건</span></div>
    `;

    const photos = await FireDB.getPhotosBySite(currentDeficiencySiteId);
    const photoMap = new Map(photos.map((p) => [p.id, p]));
    // 다른 사용자/기기에서 올려 이 기기 로컬에는 없는 사진을 구글 드라이브 백업본으로 보충한다
    // (fillMissingPhotosFromDrive 주석 참고) - 목록 렌더링 전에 채워야 아래 photoColHtml에서 바로 보인다.
    await fillMissingPhotosFromDrive(currentDeficiencySiteId, currentDeficiencies, photoMap);

    const list = $("#deficienciesList");
    if (currentDeficiencies.length === 0) {
      list.innerHTML = `<div class="empty-state">${round && round.noDeficiency
        ? "지적내역 없음으로 표시된 회차입니다."
        : "등록된 지적사항이 없습니다.<br>직접 추가하거나 자료를 올려보세요."}</div>`;
      return;
    }

    function photoColHtml(def, role) {
      const ids = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
      const thumbs = ids.map((pid) => {
        const p = photoMap.get(pid);
        if (!p) return "";
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        return `<div class="photo-thumb-wrap">
          <img class="photo-thumb" src="${url}">
          <button class="photo-thumb-remove" data-def="${def.id}" data-role="${role}" data-photo="${pid}">×</button>
        </div>`;
      }).join("");
      return `
        <div class="deficiency-photo-col">
          <span class="col-label">${role === "before" ? "이행 전" : "이행 후"}</span>
          <div class="photo-thumbs">
            ${thumbs}
            <label class="btn-add-photo-label">＋
              <input type="file" accept="image/*" class="deficiency-photo-input" data-def="${def.id}" data-role="${role}">
            </label>
          </div>
        </div>
      `;
    }

    function deficiencyCardHtml(def, idx) {
      return `
      <div class="deficiency-card" data-def="${def.id}">
        <div class="deficiency-card-number">${idx + 1}번 지적항목</div>
        <div class="field-row">
          <div class="field"><span>설비</span><input type="text" class="def-field" data-def="${def.id}" data-field="category" list="categoryList" value="${escapeHtml(def.category)}"></div>
          <div class="field"><span>층</span><input type="text" class="def-field" data-def="${def.id}" data-field="floor" value="${escapeHtml(def.floor)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><span>설치장소</span><input type="text" class="def-field" data-def="${def.id}" data-field="location" value="${escapeHtml(def.location)}"></div>
          <div class="field"><span>점검번호</span><input type="text" class="def-field" data-def="${def.id}" data-field="code" value="${escapeHtml(def.code)}"></div>
        </div>
        <div class="field"><span>${idx + 1}번 지적항목 내용</span><textarea class="def-field" data-def="${def.id}" data-field="description" rows="2">${escapeHtml(def.description)}</textarea></div>
        <div class="deficiency-photo-cols">
          ${photoColHtml(def, "before")}
          ${photoColHtml(def, "after")}
        </div>
        <div class="deficiency-resolved-row">
          <input type="checkbox" class="def-resolved" data-def="${def.id}" ${def.resolved ? "checked" : ""}>
          <span>이행완료</span>
        </div>
        <div class="deficiency-card-actions">
          <button class="btn btn-danger btn-delete-def" data-def="${def.id}">삭제</button>
        </div>
      </div>
    `;
    }

    // 미완료/완료로 나눠서 보여준다(사용자 요청) - 번호는 전체 등록 순서(idx) 그대로 유지해,
    // 이행완료 체크로 그룹이 바뀌어도 항목 번호가 바뀌지 않게 한다.
    function groupSectionHtml(title, items) {
      if (items.length === 0) return "";
      return `<div class="deficiency-group-header">${title} (${items.length}건)</div>`
        + items.map(({ def, idx }) => deficiencyCardHtml(def, idx)).join("");
    }
    const unresolvedItems = [];
    const resolvedItems = [];
    currentDeficiencies.forEach((def, idx) => {
      (def.resolved ? resolvedItems : unresolvedItems).push({ def, idx });
    });
    list.innerHTML = groupSectionHtml("미완료", unresolvedItems) + groupSectionHtml("완료", resolvedItems);

    $$("#deficienciesList .def-field").forEach((el) => {
      el.addEventListener("change", async () => {
        await setDeficiencyField(el.dataset.def, el.dataset.field, el.value);
        // 점검번호는 정규화(쉼표 삽입)된 값을 입력칸에도 바로 반영해 사용자가 결과를 즉시 확인할 수 있게 한다.
        if (el.dataset.field === "code") el.value = findDeficiency(el.dataset.def).code;
      });
    });
    $$("#deficienciesList .def-resolved").forEach((el) => {
      el.addEventListener("change", () => setDeficiencyResolved(el.dataset.def, el.checked));
    });
    $$("#deficienciesList .deficiency-photo-input").forEach((input) => {
      input.addEventListener("change", (e) => onDeficiencyPhotoSelected(input.dataset.def, input.dataset.role, e.target.files));
    });
    $$("#deficienciesList .photo-thumb-remove").forEach((btn) => {
      btn.addEventListener("click", () => removeDeficiencyPhoto(btn.dataset.def, btn.dataset.role, btn.dataset.photo));
    });
    $$("#deficienciesList .btn-delete-def").forEach((btn) => {
      btn.addEventListener("click", () => deleteDeficiency(btn.dataset.def));
    });
  }

  async function setDeficiencyField(defId, field, value) {
    const def = findDeficiency(defId);
    if (field === "code") value = normalizeInspectionCode(value);
    def[field] = value;
    await FireDB.updateDeficiency(def.id, { [field]: value });
  }

  async function setDeficiencyResolved(defId, checked) {
    const def = findDeficiency(defId);
    def.resolved = checked;
    await FireDB.updateDeficiency(def.id, { resolved: def.resolved });
    await renderDeficiencies();
  }

  async function onDeficiencyPhotoSelected(defId, role, files) {
    if (!files || files.length === 0) return;
    const def = findDeficiency(defId);
    const targetArr = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
    // 사진 저장을 시작만 해두고 기다리지 않으면(fire-and-forget), 사용자가 곧바로 다음 사진을
    // 고르거나 화면을 나가버릴 때 업로드가 끝나기 전에 끊겨 조용히 사라지는 문제가 실제로 있었다
    // (드라이브에 지적사항 사진이 단 한 장도 올라간 적이 없었음, 백엔드 자체는 정상 확인됨) -
    // 백업이 실제로 끝날 때까지 기다린 뒤에야 다음 사진으로 넘어가도록 고쳤다. backupToDrive는
    // 실패해도 절대 throw하지 않으므로(항상 조용히 무시) 여기서 기다려도 로컬 저장 흐름은 안전하다.
    // 이 사진은 나중에 다른 기기(PC 등)에서 이행완료보고서를 만들 때 로컬에 원본이 없으면 구글
    // 드라이브 백업본으로 대신 채워진다(위 openCompletionReport 참고) - 그래서 백업이 꺼져 있지
    // 않은데도 실패하면(네트워크/서버 문제 등) 조용히 넘기지 않고 바로 알려준다.
    ImportLoading.show("사진을 저장하고 있습니다.");
    try {
      let idx = 0;
      for (const file of files) {
        idx++;
        ImportLoading.setProgress((idx / files.length) * 100, files.length > 1 ? `사진을 저장하고 있습니다. (${idx}/${files.length})` : "사진을 저장하고 있습니다.");
        // 파일 선택창의 accept="image/*"는 SVG(아이콘/그림 파일)도 걸러내지 못한다 - 벡터 이미지는
        // 절대 실제 현장 사진이 아니므로, 여기서 거르지 않으면 보고서에 그대로(비정상적으로 확대되어)
        // 들어가버린다(실제 사용자가 겪은 문제).
        if (file.type === "image/svg+xml") {
          toast("아이콘/그림 파일(SVG)은 사진으로 등록할 수 없습니다. 실제 사진 파일을 선택해주세요.", "error");
          continue;
        }
        const uploadFile = await compressPhotoForUpload(file);
        const photo = await FireDB.addPhoto({
          siteId: currentDeficiencySiteId,
          itemId: def.id,
          role,
          blob: uploadFile,
          createdAt: new Date().toISOString()
        });
        targetArr.push(photo.id);
        const result = await backupToDrive(currentDeficiencySiteId, "지적사항_사진", `${role === "before" ? "이행전" : "이행후"}_${photo.id}.jpg`, uploadFile);
        if (!result && DriveBackup.isEnabled()) {
          toast("사진은 저장됐지만 구글 드라이브 자동 백업에는 실패했습니다(네트워크 확인).", "error");
        }
      }
    } finally {
      ImportLoading.hide();
    }
    const changes = { beforePhotoIds: def.beforePhotoIds, afterPhotoIds: def.afterPhotoIds };
    // 이행후 사진이 곧 수리 완료의 증거이므로, 한 장이라도 올라오면 이행완료를 자동으로 체크해준다.
    if (role === "after" && !def.resolved) {
      def.resolved = true;
      changes.resolved = true;
    }
    await FireDB.updateDeficiency(def.id, changes);
    await renderDeficiencies();
  }

  async function removeDeficiencyPhoto(defId, role, photoId) {
    const def = findDeficiency(defId);
    const key = role === "before" ? "beforePhotoIds" : "afterPhotoIds";
    def[key] = def[key].filter((id) => id !== photoId);
    await FireDB.deletePhoto(photoId);
    await FireDB.updateDeficiency(def.id, { [key]: def[key] });
    await renderDeficiencies();
  }

  async function deleteDeficiency(defId) {
    const ok = await confirmDialog("이 지적사항을 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteDeficiency(defId);
    currentDeficiencies = currentDeficiencies.filter((d) => d.id !== defId);
    await renderDeficiencies();
  }

  $("#btnBackFromDeficiencies").addEventListener("click", async () => {
    await renderDeficiencyRounds();
    showScreen("screen-deficiency-rounds");
  });

  $("#btnAddDeficiency").addEventListener("click", async () => {
    const newDef = newDeficiency({});
    await FireDB.addDeficiency(newDef);
    currentDeficiencies.push(newDef);
    await renderDeficiencies();
    const card = document.querySelector(`.deficiency-card[data-def="${newDef.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstField = card.querySelector(".def-field");
      if (firstField) firstField.focus();
    }
  });

  $("#btnDeleteAllDeficiencies").addEventListener("click", async () => {
    if (currentDeficiencies.length === 0) {
      toast("삭제할 지적사항이 없습니다.");
      return;
    }
    const ok = await confirmDialog(`지적사항 ${currentDeficiencies.length}건을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    for (const def of currentDeficiencies.slice()) {
      await FireDB.deleteDeficiency(def.id);
    }
    currentDeficiencies = [];
    await renderDeficiencies();
    toast("지적사항을 모두 삭제했습니다.");
  });

  // 이 회차를 "확인해봤는데 지적사항이 정말 없다"고 표시한다 - 회차 단위 플래그(round.noDeficiency)를
  // 쓰므로, 다른 회차(옛 회차·새 회차)의 표시에는 영향을 주지 않는다. 최신 회차일 때만 지적사항
  // 메인메뉴의 업체 배지에도 곧바로 "지적사항 없음"으로 반영된다(latestRoundCountsBySite가 최신
  // 회차 기준으로 보기 때문).
  $("#btnMarkRoundNoDeficiency").addEventListener("click", async () => {
    if (currentDeficiencies.length > 0) {
      toast("이미 등록된 지적사항이 있습니다. 먼저 삭제한 뒤 이용해주세요.", "error");
      return;
    }
    const ok = await confirmDialog("이 현장은 지적사항이 없는 것으로 표시할까요?");
    if (!ok) return;
    await FireDB.updateRound(currentRoundId, { noDeficiency: true });
    toast("지적사항 없음으로 표시했습니다.");
    await renderDeficiencies();
  });

  $("#btnDeleteAllSiteDeficiencies").addEventListener("click", async () => {
    const defs = await FireDB.getDeficienciesBySite(currentDeficiencySiteId);
    if (defs.length === 0) {
      toast("삭제할 지적사항이 없습니다.");
      return;
    }
    const ok = await confirmDialog(`이 현장의 모든 점검 회차에 등록된 지적사항 ${defs.length}건을 전부 삭제할까요?\n점검 회차 자체는 남고 그 안의 지적사항만 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    for (const def of defs) {
      await FireDB.deleteDeficiency(def.id);
    }
    toast("모든 지적사항을 삭제했습니다.");
    await renderDeficiencyRounds();
  });

  // "지적사항 자료 올리기"를 누르면 바로 OS 파일 선택창을 여는 대신, 파일 선택 버튼과 드롭 영역을
  // 함께 보여주는 작은 창을 띄운다 - 화면 아무데나 끌어다 놓아도 되는 건(setupFileDropZone) 알기
  // 어려우므로, 버튼을 눌렀을 때 "여기로 끌어다 놓거나 선택하세요"를 눈에 보이게 안내하기 위함.
  $("#btnImportData").addEventListener("click", () => $("#fileUploadModal").classList.remove("hidden"));
  $("#fileUploadCancelBtn").addEventListener("click", () => $("#fileUploadModal").classList.add("hidden"));
  $("#fileUploadBrowseBtn").addEventListener("click", () => $("#dataImportInput").click());
  setupFileDropZone($("#fileUploadDropZone"), (file) => {
    $("#fileUploadModal").classList.add("hidden");
    handleDeficiencyImportFile(file);
  });

  // 파일 입력 change 이벤트와 드래그앤드롭 양쪽에서 재사용하도록 File 객체를 직접 받는 함수로 분리.
  async function handleDeficiencyImportFile(file) {
    if (!file) return;
    const driveBackupPromise = backupToDrive(currentDeficiencySiteId, "지적사항_자료", file.name, file);
    const ext = file.name.split(".").pop().toLowerCase();
    ImportLoading.show(AiFill.isEnabled() ? "AI가 자료를 분석하고 있습니다." : "자료를 분석하고 있습니다.");
    ImportLoading.startSimulated();
    try {
      let rows = null;
      let lowConfidence = false;
      let typeLabel = "";
      // 구 HWP는 AiFill이 직접 다루지 못하므로(isSupportedExt에 없음) 거래처 등록 가져오기와 동일하게
      // 먼저 hwpx로 변환해서 넘긴다 - 변환 실패 시 원본 그대로 두면 아래에서 "지원하지 않는 형식"으로
      // 처리된다(이 문서는 표 구조가 있어야 인식되므로, 변환된 hwpx도 AI 전용 경로만 탄다 - FireImport엔
      // hwpx 표 파서가 없다).
      let aiFile = file;
      if (ext === "hwp") {
        const convertedHwpx = await ClientImport.convertHwpToHwpxViaService(file);
        if (convertedHwpx) aiFile = new File([convertedHwpx], file.name.replace(/\.hwp$/i, ".hwpx"));
      }
      const aiExt = aiFile.name.split(".").pop().toLowerCase();
      if (AiFill.isEnabled() && AiFill.isSupportedExt(aiExt)) {
        try {
          const aiResult = await AiFill.analyzeDeficiencyFile(aiFile);
          rows = aiResult.rows;
          typeLabel = aiResult.typeLabel;
        } catch (aiErr) {
          rows = null; // AI 분석 실패 시 기존 방식으로 폴백
        }
      }
      if (!rows) {
        if (ext === "xlsx" || ext === "xls") {
          rows = await FireImport.parseExcelFile(file);
          typeLabel = "엑셀";
        } else if (ext === "docx") {
          rows = await FireImport.parseWordFile(file);
          typeLabel = "워드 문서";
        } else if (ext === "pdf") {
          const result = await FireImport.parsePdfFile(file);
          rows = result.rows;
          lowConfidence = result.lowConfidence;
          typeLabel = "PDF";
        } else if (aiExt === "hwpx") {
          // AI(Gemini) 호출이 실패해도(프록시 장애, 모델 사용중지 등) 표 구조가 있는 문서는 여기서
          // 건질 수 있다 - hwp는 위에서 hwpx로 변환됐을 때만(aiExt) 이 경로를 탄다.
          rows = await FireImport.parseHwpxFile(aiFile);
          typeLabel = "한글(HWPX)";
        } else {
          toast(`지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf${AiFill.isEnabled() ? ", .hwp, .hwpx, 사진" : ""}만 가능).`, "error");
          return;
        }
      }
      if (!rows || rows.length === 0) {
        toast(`${typeLabel || "파일"}에서 지적사항 표를 인식하지 못했습니다. 다른 파일을 이용하거나 직접 입력해주세요.`, "error");
        return;
      }
      for (const r of rows) {
        const def = newDeficiency(r);
        await FireDB.addDeficiency(def);
        currentDeficiencies.push(def);
      }
      await renderDeficiencies();
      toast(`${typeLabel}에서 ${rows.length}개 지적사항을 가져왔습니다.${lowConfidence ? " (인식 품질이 낮을 수 있어 내용을 확인해주세요.)" : ""}`);
    } catch (err) {
      toast("파일을 읽는 중 오류가 발생했습니다.", "error");
    } finally {
      await driveBackupPromise;
      ImportLoading.hide();
    }
  }
  $("#dataImportInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    $("#fileUploadModal").classList.add("hidden");
    handleDeficiencyImportFile(file);
  });
  // 탐색기/다른 폴더에서 파일을 끌어다 놓아도 "지적사항 자료 올리기" 버튼을 누른 것과 똑같이 동작.
  setupFileDropZone($("#screen-deficiencies"), handleDeficiencyImportFile);

  // ---------- 이행완료 보고서 ----------
  $("#btnGenerateCompletionReport").addEventListener("click", async () => {
    const resolved = currentDeficiencies.filter((d) => d.resolved);
    if (resolved.length === 0) {
      toast("이행완료로 표시된 지적사항이 없습니다. 목록에서 이행완료 여부를 먼저 체크해주세요.", "error");
      return;
    }
    await openCompletionReport();
  });

  let lastCompletionReportData = null;

  async function openCompletionReport() {
    revokeObjectUrls();
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const company = await getCompanyProfile();
    const resolved = currentDeficiencies.filter((d) => d.resolved);
    // 이행조치 일자는 더 이상 자동 기록하지 않고, 실제 제출 시점에 손으로 적도록 항상 공란으로 둔다.
    const dateRange = ". . . ~ . . .";

    const photos = await FireDB.getPhotosBySite(currentDeficiencySiteId);
    const photoMap = new Map(photos.map((p) => [p.id, p]));
    // 사진은 기기별 IndexedDB에만 저장된다 - 휴대폰으로 찍어 올린 사진은 PC 등 다른 기기의 로컬
    // 저장소엔 원본이 없어 여기서 빠질 수 있다(실제 사용자가 겪은 문제: "PC에서 이행완료보고서
    // 만들면 텍스트는 나오는데 사진은 안 나옴"). fillMissingPhotosFromDrive가 구글 드라이브 백업본으로
    // 채운다 - 둘 다에 없으면 기존과 동일하게 "사진 없음"으로 표시된다.
    await fillMissingPhotosFromDrive(currentDeficiencySiteId, resolved, photoMap);

    function photoCellHtml(def, role) {
      const ids = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
      if (ids.length === 0) return `<div class="no-photo">사진 없음</div>`;
      return ids.map((pid) => {
        const p = photoMap.get(pid);
        if (!p) return "";
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        return `<img src="${url}">`;
      }).join("");
    }

    const siteName = site ? site.name || "-" : "-";
    const siteType = site ? site.buildingType || "-" : "-";
    const siteAddr = site ? site.address || "-" : "-";
    const contactName = site ? site.contactName || "" : "";
    const contactPhone = site ? site.contactPhone || "" : "";
    const managerName = site ? site.fireManagerName || "" : "";
    const managerPhone = site ? site.fireManagerPhone || "" : "";
    const fireStation = site ? (site.fireStation || guessFireStation(site.address)) : "";
    const fireStationLine = fireStation ? `${escapeHtml(fireStation)}장 귀하` : "○○ 소방본부장ㆍ소방서장 귀하";

    // 지적내역서는 사진 있는 항목이 페이지를 길게 늘어뜨리므로, 한 페이지에 4건씩만 담고
    // 나머지는 다음 페이지로 넘긴다 (화면 네비게이션과 인쇄/PDF 양쪽 다 이 단위로 쪽이 나뉜다).
    const DETAIL_ITEMS_PER_PAGE = 4;
    const detailChunks = [];
    for (let i = 0; i < resolved.length; i += DETAIL_ITEMS_PER_PAGE) {
      detailChunks.push(resolved.slice(i, i + DETAIL_ITEMS_PER_PAGE));
    }
    if (detailChunks.length === 0) detailChunks.push([]);

    const detailPagesHtml = detailChunks.map((items, idx) => {
      const rowsHtml = items.map((def) => `
        <tr>
          <td class="did-content">
            <strong>${escapeHtml([def.floor, def.location].filter(Boolean).join(" "))}</strong>
            <div class="report-item-note">${escapeHtml(def.description)}</div>
          </td>
          <td class="did-photo completion-photo-cell" data-photo-label="이행 전">${photoCellHtml(def, "before")}</td>
          <td class="did-photo completion-photo-cell" data-photo-label="이행 후">${photoCellHtml(def, "after")}</td>
        </tr>
      `).join("");
      const pageLabel = detailChunks.length > 1 ? ` (${idx + 1}/${detailChunks.length}쪽)` : "";
      return `
        <div class="report-page">
          <div class="official-form-title">지적내역서 (대상물: ${escapeHtml(siteName)})${pageLabel}</div>
          <table class="completion-table">
            <colgroup>
              <col class="did-content">
              <col class="did-photo">
              <col class="did-photo">
            </colgroup>
            <thead>
              <tr>
                <th colspan="3">이행완료 보고서 증빙자료</th>
              </tr>
              <tr>
                <th class="did-content did-result-label" rowspan="2">이행결과</th>
                <th class="did-photo official-table-note" colspan="2">1. 이행 조치 건별 전ㆍ후 사진<br>2. 공사계약서 등 증빙서류 첨부(별첨)</th>
              </tr>
              <tr>
                <th class="did-photo">이행 전</th>
                <th class="did-photo">이행 후</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    }).join("");

    $("#completionReportContent").innerHTML = `
      <div class="official-form">
      <div class="report-page">
        <div class="official-form-topnote">■ 소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제11호서식]</div>
        <div class="official-form-title">소방시설등의 자체점검 결과 이행완료 보고서</div>

        <table class="official-table">
          <tr>
            <td class="section-label" rowspan="3">특정소방<br>대상물</td>
            <td class="field-label">대상물 명칭(상호)</td>
            <td>${escapeHtml(siteName)}</td>
            <td class="field-label">대상물 구분(용도)</td>
            <td>${escapeHtml(siteType)}</td>
          </tr>
          <tr>
            <td class="field-label">관계인</td>
            <td>성명: ${escapeHtml(contactName || "-")}<br>전화번호: <span class="nowrap">${escapeHtml(contactPhone ? formatPhone(contactPhone) : "-")}</span></td>
            <td class="field-label">소방안전관리자</td>
            <td>성명: ${escapeHtml(managerName || "-")}<br>전화번호: <span class="nowrap">${escapeHtml(managerPhone ? formatPhone(managerPhone) : "-")}</span></td>
          </tr>
          <tr>
            <td class="field-label">소재지</td>
            <td colspan="3">${escapeHtml(siteAddr)}</td>
          </tr>
        </table>

        <table class="official-table">
          <tr>
            <td class="section-label" rowspan="3">소방공사<br>업체</td>
            <td class="field-label">업체명(상호)</td>
            <td>${escapeHtml(company.name || "-")}</td>
            <td class="field-label">사업자번호</td>
            <td>${escapeHtml(company.bizRegNo || "-")}</td>
          </tr>
          <tr>
            <td class="field-label">대표이사</td>
            <td colspan="3">성명: ${escapeHtml(company.ceo || "-")} 　전화번호: <span class="nowrap">${escapeHtml(company.phone ? formatPhone(company.phone) : "-")}</span></td>
          </tr>
          <tr>
            <td class="field-label">소재지</td>
            <td colspan="3">${escapeHtml(company.address || "-")}</td>
          </tr>
        </table>

        <table class="official-table official-table-spaced">
          <tr>
            <td class="section-label">이행완료<br>사항</td>
            <td class="field-label">이행조치 내용</td>
            <td>※ 지 적 내 역 참 조 ※</td>
            <td class="field-label">이행조치 일자</td>
            <td>${escapeHtml(dateRange)}</td>
          </tr>
        </table>

        <p class="official-form-legal">
          「소방시설 설치 및 안전관리에 관한 법률」 제23조제4항 및 같은 법 시행규칙 제23조제6항에 따라 위와 같이 소방시설등의 수리ㆍ교체ㆍ정비에 대한 이행완료 보고서를 제출합니다.
        </p>

        <div class="official-form-sign">
          <div>　　년　　월　　일</div>
          <div>관계인: ${escapeHtml(contactName || "")}　　　　　(서명 또는 인)</div>
          <div>${fireStationLine}</div>
        </div>

        <table class="official-table official-table-spaced">
          <tr>
            <td class="field-label">첨부서류</td>
            <td>1. 이행계획 건별 이행 전ㆍ후 사진 증명자료 1부<br>2. 소방시설공사 계약서(이행조치 내용과 관련됩니다) 1부</td>
          </tr>
          <tr>
            <td colspan="2" class="official-table-bar">유의 사항</td>
          </tr>
          <tr>
            <td class="field-label">「소방시설 설치 및 관리에 관한 법률」 제61조제1항 제8호 및 제9호</td>
            <td>1. 특정소방대상물의 관계인이 법 제22조에 따른 소방시설등의 자체점검 결과에 따른 수리ㆍ조치ㆍ정비사항 발생 시 이행계획서를 첨부하지 않거나 거짓으로 제출한 경우 300만원 이하의 과태료를 부과합니다.<br>2. 특정소방대상물의 관계인이 소방시설등의 수리ㆍ조치ㆍ정비 이행계획을 별도의 연기신청 없이 기간 내에 완료하지 않은 경우 300만원 이하의 과태료를 부과합니다.</td>
          </tr>
        </table>

        <div class="official-form-footer">210mm×297mm[백상지(80g/㎡) 또는 중질지(80g/㎡)]</div>
      </div>
      ${detailPagesHtml}
      </div>
    `;
    lastCompletionReportData = { site, company, resolved, photoMap, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr, fireStation };
    completionReportPages = Array.from($("#completionReportContent").querySelectorAll(".report-page"));
    // showScreen을 먼저 해서 컨테이너가 실제로 화면에 보이게 만든 다음에 축소 계산을 해야 한다 -
    // display:none 상태에서 재면 폭이 0으로 나와 축소 비율 계산이 틀어진다.
    showScreen("screen-completion-report");
    showCompletionReportPage(0);
    // 사진(<img>)은 비동기로 로드되며 로드 후 표 높이가 바뀔 수 있어, 다 실린 뒤 축소를 다시 맞춘다.
    $$("#completionReportContent img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", fitCompletionReportScale, { once: true });
    });
  }

  let completionReportPages = [];
  let completionReportPageIndex = 0;

  // 표(.official-form)의 실제 폭(가로 스크롤이 필요했던 그 폭)이 화면에 안 들어가면, 표를 줄바꿈/재배치
  // 하지 않고 가로세로 비율 그대로 통째로 축소(transform: scale)해서 스크롤 없이 한 화면에 담는다.
  // 화면이 넓어서 원래도 들어가면 축소하지 않는다(자연스러운 원본 크기 그대로).
  function fitCompletionReportScale() {
    const container = $("#completionReportContent");
    const form = container && container.querySelector(".official-form");
    if (!container || !form) return;
    const naturalWidth = form.scrollWidth;
    const naturalHeight = form.scrollHeight;
    const available = container.clientWidth;
    if (!naturalWidth || !available || naturalWidth <= available) {
      form.style.transform = "";
      form.style.marginBottom = "";
      return;
    }
    const scale = available / naturalWidth;
    form.style.transform = `scale(${scale})`;
    // transform은 레이아웃 공간을 그대로 차지하므로, 줄어든 만큼을 음수 마진으로 걷어내
    // 페이지 아래(이전/다음 버튼 등)에 빈 여백이 남지 않게 한다.
    form.style.marginBottom = `${Math.round(naturalHeight * scale - naturalHeight)}px`;
  }
  window.addEventListener("resize", () => {
    if ($("#screen-completion-report").classList.contains("active")) fitCompletionReportScale();
  });

  function showCompletionReportPage(idx) {
    if (!completionReportPages.length) return;
    completionReportPageIndex = Math.max(0, Math.min(idx, completionReportPages.length - 1));
    completionReportPages.forEach((el, i) => el.classList.toggle("active", i === completionReportPageIndex));
    const total = completionReportPages.length;
    $("#completionPageIndicator").textContent = `${completionReportPageIndex + 1} / ${total}`;
    $("#btnCompletionPrevPage").disabled = completionReportPageIndex === 0;
    $("#btnCompletionNextPage").disabled = completionReportPageIndex === total - 1;
    $("#completionReportPager").classList.toggle("hidden", total <= 1);
    fitCompletionReportScale();
  }

  $("#btnCompletionPrevPage").addEventListener("click", () => showCompletionReportPage(completionReportPageIndex - 1));
  $("#btnCompletionNextPage").addEventListener("click", () => showCompletionReportPage(completionReportPageIndex + 1));

  $("#btnDownloadCompletionHwpx").addEventListener("click", async () => {
    if (!lastCompletionReportData) return;
    const btn = $("#btnDownloadCompletionHwpx");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const blob = await HwpxExport.generateCompletionReportHwpx(lastCompletionReportData);
      await backupToDrive(
        lastCompletionReportData.site ? lastCompletionReportData.site.id : null,
        "이행완료보고서",
        `이행완료보고서_${lastCompletionReportData.siteName}_${todayISO()}.hwpx`,
        blob
      );
      // 앱(APK) 안의 WebView는 <a download>로 조용히 다운로드하는 게 안 보이거나 그냥 안 될 때가
      // 많다(사용자가 실제로 겪은 문제) - 네이티브에서는 안드로이드 표준 "다운로드" 폴더에 직접 저장하고
      // (FileSaver 네이티브 플러그인) 실제 저장된 위치를 그대로 알려준다.
      const filename = `이행완료보고서_${lastCompletionReportData.siteName}.hwpx`;
      if (isNativeApp()) {
        btn.textContent = "저장 중...";
        const saved = await nativeSaveToDownloads(blob, filename, "application/hwp+zip");
        toast(`저장되었습니다: ${saved.location}`, "success");
        await nativeOfferToOpen(saved.uri, saved.mimeType);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast("HWPX 파일이 생성되었습니다. 한글 프로그램에서 정상적으로 열리는지 꼭 확인해주세요.", "success");
      }
    } catch (err) {
      toast("HWPX 파일 생성에 실패했습니다: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnBackFromCompletionReport").addEventListener("click", async () => {
    await renderDeficiencies();
    showScreen("screen-deficiencies");
  });

  // 안드로이드 WebView는 window.print()를 기본적으로 지원하지 않는다(PrintManager 네이티브
  // 연동이 따로 있어야 하는데, 이 프로젝트엔 없다) - 그냥 조용히 아무 반응도 없다(사용자가 실제로
  // 겪은 문제). 네이티브 앱에서는 대신 이미 있는 PDF 생성 경로(공유 버튼과 동일)로 PDF 파일을
  // 만들어 다운로드 폴더에 저장하고 바로 열도록 한다. 웹(데스크톱 브라우저)에서는 실제 인쇄도
  // 가능한 window.print()가 더 유용하므로 그대로 둔다.
  // 네이티브 앱에서는 실제 "인쇄"가 아니라 PDF 저장만 일어나므로 버튼 문구를 그에 맞게 바꾼다.
  if (isNativeApp()) $("#btnPrintCompletionReport").textContent = "PDF 저장";
  $("#btnPrintCompletionReport").addEventListener("click", async () => {
    if (!isNativeApp()) {
      window.print();
      return;
    }
    const btn = $("#btnPrintCompletionReport");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "PDF 생성 중...";
    try {
      const blob = await generateCompletionReportPdfBlob();
      const filename = `이행완료보고서_${lastCompletionReportData.siteName}.pdf`;
      btn.textContent = "저장 중...";
      const saved = await nativeSaveToDownloads(blob, filename, "application/pdf");
      toast(`저장되었습니다: ${saved.location}`, "success");
      await nativeOfferToOpen(saved.uri, saved.mimeType);
    } catch (err) {
      toast("PDF 생성에 실패했습니다: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  async function generateCompletionReportPdfBlob() {
    const el = $("#completionReportContent");
    // 화면에서는 한 번에 한 페이지만 보이지만(.report-page.active), PDF에는 전체 페이지가
    // 다 들어가야 하므로 캡처 직전에만 전부 보이게 전환한다 - html2canvas는 @media print를
    // 반영하지 않으므로 인쇄용 CSS만으로는 부족하다. 좁은 화면에서 스크롤 없이 보이도록
    // fitCompletionReportScale이 걸어둔 축소(transform)도 마찬가지로 @media print를 안 타서,
    // 캡처 직전에 걷어내지 않으면 PDF까지 작게 찍힌다 - 캡처 후 화면용 축소를 다시 계산해 돌려놓는다.
    const form = el.querySelector(".official-form");
    if (form) { form.style.transform = ""; form.style.marginBottom = ""; }
    el.classList.add("pdf-export-all-pages");
    try {
      return await html2pdf()
        .set({
          margin: 8,
          filename: "report.pdf",
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] }
        })
        .from(el)
        .outputPdf("blob");
    } finally {
      el.classList.remove("pdf-export-all-pages");
      fitCompletionReportScale();
    }
  }

  // 파일 공유를 지원하는 브라우저(모바일 대부분)면 공유 시트를 띄우고, 아니면 파일을 바로 다운로드한다.
  async function shareOrDownloadFile(blob, filename, mimeType) {
    if (isNativeApp()) {
      try {
        await nativeShareFiles([{ blob, name: filename }], "이행완료 보고서");
        return;
      } catch (e) {
        if (e && e.message && /cancel/i.test(e.message)) return; // 사용자가 공유 화면에서 취소함
        toast("공유 화면을 여는 데 실패했습니다: " + (e && e.message ? e.message : "알 수 없는 오류"), "error");
        return;
      }
    }
    const file = new File([blob], filename, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "이행완료 보고서" });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // 사용자가 공유를 취소함
        // 그 외 오류(공유 대상 없음 등)면 아래에서 다운로드로 대체 처리
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${filename} 파일이 다운로드되었습니다. 원하는 방법으로 공유해주세요.`, "success");
  }

  $("#btnShareCompletionReport").addEventListener("click", async () => {
    if (!lastCompletionReportData) return;
    const format = await pickShareFormat();
    if (!format) return;
    const btn = $("#btnShareCompletionReport");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "생성 중...";
    // 공유 시트가 뜨는 걸 드라이브 백업 완료까지 기다리게 하고 싶진 않지만, 공유 시트를 연 뒤
    // 함수가 바로 끝나버리면(백업이 아직 진행 중이어도) 조용히 끊길 위험이 있으므로 finally에서 기다린다.
    let driveBackupPromise = Promise.resolve(null);
    try {
      const filenameBase = `이행완료보고서_${lastCompletionReportData.siteName}`;
      const siteId = lastCompletionReportData.site ? lastCompletionReportData.site.id : null;
      if (format === "hwpx") {
        const blob = await HwpxExport.generateCompletionReportHwpx(lastCompletionReportData);
        driveBackupPromise = backupToDrive(siteId, "이행완료보고서", `${filenameBase}_${todayISO()}.hwpx`, blob);
        btn.textContent = "공유 화면 여는 중...";
        await shareOrDownloadFile(blob, `${filenameBase}.hwpx`, "application/hwp+zip");
      } else {
        const blob = await generateCompletionReportPdfBlob();
        driveBackupPromise = backupToDrive(siteId, "이행완료보고서", `${filenameBase}_${todayISO()}.pdf`, blob);
        btn.textContent = "공유 화면 여는 중...";
        await shareOrDownloadFile(blob, `${filenameBase}.pdf`, "application/pdf");
      }
    } catch (err) {
      toast("파일 생성에 실패했습니다: " + err.message, "error");
    } finally {
      await driveBackupPromise;
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ================= 동선 =================
  const DEFAULT_COMPANY = { name: "조은소방", address: "대구시 수성구 중동 551-49", phone: "", ceo: "", bizRegNo: "", licenseNo: "" };

  // 업체 정보는 팀 전체가 공유하는 값이라 Firebase(공유 저장소)에 둔다 - 한 사람이 설정 탭에서
  // 고치면 다른 사람 화면에도 바로 그 값으로 보인다(예전엔 기기별 localStorage라 서로 달랐음).
  async function getCompanyProfile() {
    const parsed = await FireDB.getCompanyProfile();
    if (!parsed) return { ...DEFAULT_COMPANY };
    return {
      name: parsed.name || DEFAULT_COMPANY.name,
      address: parsed.address || DEFAULT_COMPANY.address,
      phone: parsed.phone || "",
      ceo: parsed.ceo || "",
      bizRegNo: parsed.bizRegNo || "",
      licenseNo: parsed.licenseNo || ""
    };
  }

  async function saveCompanyProfile(profile) {
    return FireDB.saveCompanyProfile(profile);
  }

  async function renderRoute() {
    const d = new Date();
    $("#routeHeaderTitle").textContent = `일정관리 ${todayISO()} (${WEEKDAY_LABEL[d.getDay()]})`;
    await renderScheduleAgenda();
    await renderInspectionStatus();
  }

  // 오늘의 점검현황 - "스케줄 관리"에서 정한 오늘 방문 순서(schedules/오늘날짜.siteIds) 그대로
  // 보여주고, 그 자리에서 바로 "점검완료"를 누를 수 있게 한다. 완료 여부는 그 업체의 오늘 날짜
  // 점검 회차(inspections, scheduledDate가 오늘인 것)가 있는지/완료 상태인지로 판단한다 - 아직
  // 회차가 없으면(점검 시작 전) "예정"으로 보이고, "점검완료"를 누르면 회차를 새로 만들면서
  // 동시에 완료 처리한다(체크리스트/사진을 굳이 안 열어봐도 방문했음만 빠르게 표시할 수 있도록).
  // 표시 전용 - 완료 처리는 여기서 하지 않는다(거래처 상세/점검 상세 화면의 "✅ 점검 완료 처리"로만
  // 하고, 여기는 그 결과를 그대로 반영해서 보여주기만 함, 사용자 요청).
  async function renderInspectionStatus() {
    const list = $("#inspectionStatusList");
    if (!list) return;
    const today = todayISO();
    const [sched, sites, inspections] = await Promise.all([
      FireDB.getScheduleByDate(today), FireDB.getAllSites(), FireDB.getAllInspections()
    ]);
    // 일정 확정("스케줄 관리"의 "일정 확정" 버튼)된 날짜만 여기 표시한다(사용자 요청) - 아직
    // 확정 안 된(후보만 담아둔) 날짜는 여기 안 뜨고 스케줄 관리 화면에서만 보인다.
    const siteIds = (sched && sched.confirmed) ? sched.siteIds : [];
    if (siteIds.length === 0) {
      list.innerHTML = `<div class="empty-state">오늘 확정된 일정이 없습니다.</div>`;
      return;
    }
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    list.innerHTML = siteIds.map((id, idx) => {
      const site = siteMap.get(id);
      const todayInsp = inspections.find((i) => i.siteId === id && i.scheduledDate === today);
      const done = !!(todayInsp && todayInsp.status === "completed");
      return `
        <div class="list-card">
          <div class="list-card-title">
            <span>${idx + 1}. ${escapeHtml(site ? site.name : "삭제된 업체")}</span>
            <span class="badge badge-${done ? "completed" : "scheduled"}">${done ? "완료" : "예정"}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  async function renderScheduleAgenda() {
    const [inspections, sites] = await Promise.all([FireDB.getAllInspections(), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const upcoming = inspections.filter((i) => i.status !== "completed" && i.scheduledDate);
    const byDate = new Map();
    upcoming.forEach((i) => {
      if (!byDate.has(i.scheduledDate)) byDate.set(i.scheduledDate, []);
      byDate.get(i.scheduledDate).push(i);
    });
    // 오늘 날짜는 카드 상단 제목("일정관리 YYYY-MM-DD (요일)")과 바로 아래 "오늘의 점검현황"에서
    // 이미 보여주므로, 이 목록에는 오늘을 뺀 다른 날짜(과거 기한초과/향후 예정)만 남긴다(사용자 요청).
    const today = todayISO();
    const dates = Array.from(byDate.keys()).filter((d) => d !== today).sort();

    const list = $("#scheduleAgenda");
    if (dates.length === 0) {
      // 보여줄 게 없으면 문구 없이 그냥 빈 칸으로 둔다(사용자 요청 - 안내 문구가 보기에 안 좋음).
      list.innerHTML = "";
      return;
    }
    // 각 날짜의 업체 나열 순서는 스케줄 관리에서 정한 방문 순서를 따른다(사용자 요청). 예정/기한초과
    // 배지는 바로 아래 "오늘의 점검현황"이 이미 보여주므로 여기서는 중복으로 표시하지 않는다.
    const schedules = await Promise.all(dates.map((date) => FireDB.getScheduleByDate(date)));
    const scheduleByDate = new Map(dates.map((date, idx) => [date, schedules[idx]]));
    list.innerHTML = dates.map((date) => {
      const items = byDate.get(date).slice();
      const order = new Map(((scheduleByDate.get(date) || {}).siteIds || []).map((id, idx) => [id, idx]));
      items.sort((a, b) => {
        const ra = order.has(a.siteId) ? order.get(a.siteId) : Infinity;
        const rb = order.has(b.siteId) ? order.get(b.siteId) : Infinity;
        return ra - rb;
      });
      const d = new Date(date + "T00:00:00");
      const dateLabel = !isNaN(d) ? `${date} (${WEEKDAY_LABEL[d.getDay()]})` : date;
      const names = items.map((i) => escapeHtml(siteMap.get(i.siteId) ? siteMap.get(i.siteId).name : "알 수 없는 현장")).join(", ");
      return `
        <div class="list-card" data-date="${date}">
          <div class="list-card-title">
            <span>${escapeHtml(dateLabel)}</span>
          </div>
          <div class="list-card-sub">${names} (${items.length}건)</div>
        </div>
      `;
    }).join("");
  }

  const CHANGE_HISTORY_VISIBLE_KEY = "fireInspectionShowChangeHistory";
  function isChangeHistoryVisible() {
    const v = localStorage.getItem(CHANGE_HISTORY_VISIBLE_KEY);
    return v === null ? true : v === "1";
  }
  function setChangeHistoryVisible(on) {
    localStorage.setItem(CHANGE_HISTORY_VISIBLE_KEY, on ? "1" : "0");
  }

  async function renderSettings() {
    const profile = await getCompanyProfile();
    $("#companyName").value = profile.name;
    $("#companyAddress").value = profile.address;
    $("#companyPhone").value = profile.phone;
    $("#companyCeo").value = profile.ceo;
    $("#companyBizRegNo").value = profile.bizRegNo;
    $("#companyLicenseNo").value = profile.licenseNo;
    const apiKeys = BldReg.getKeys();
    $("#jusoApiKey").value = apiKeys.jusoKey || "";
    $("#dataGoKrApiKey").value = apiKeys.dataGoKrKey || "";
    $("#aiEnabledToggle").checked = AiFill.isEnabled();
    $("#changeHistoryEnabledToggle").checked = isChangeHistoryVisible();
    renderDriveStatus();
    $("#authCurrentUser").textContent = Auth.getDisplayName();
  }

  // ---------- 앱 버전 / 업데이트 확인 ----------
  // 사이드로드 앱(스토어 밖에서 apk로 설치)은 스스로를 조용히 덮어쓸 수 없으므로(설치는 항상 사용자
  // 확인 필요), 새 버전이 있으면 외부 브라우저로 APK 다운로드 URL을 열어 다운로드->설치를 대신 시작해준다.
  // version.js의 APP_VERSION은 마지막으로 웹 파일이 바뀐 실제 날짜/시간(한국시간)이고,
  // APP_VERSION_CODE/NAME은 APK를 새로 빌드해서 배포할 때만 올리는 별개의 버전 번호다.
  const APP_VERSION_CODE = 46;
  const APP_VERSION_NAME = "1.45";
  const UPDATE_MANIFEST_URL = "https://green3077.github.io/sobang1004/version.json";
  const IS_NATIVE_UPDATE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // 이 프로젝트는 번들러(webpack/vite 등)를 쓰지 않는 순수 스크립트 앱이라 @capacitor/core 전체가
  // 로드되지 않고, 네이티브가 자동 주입하는 가벼운 native-bridge.js만 있다 - 거기엔 registerPlugin()이
  // 없다(그건 @capacitor/core 패키지 쪽 API라 window.Capacitor.registerPlugin은 항상 존재하지 않는
  // 함수였다 - 이 한 줄의 예외가 여기부터 파일 끝까지 나머지 스크립트 실행을 통째로 멈춰버려서
  // 업데이트 확인/로그아웃 버튼이 아예 연결 안 되고, 자동 부팅(Auth.onReady)도 못 걸리는 게
  // "홈 화면이 안 뜨고 버튼이 안 눌리는" 문제의 실제 원인이었다). native-bridge.js가 실제로 제공하는
  // 저수준 API인 nativePromise(pluginName, methodName, options)로 직접 호출한다.
  function callUpdateBridge(method, options) {
    return window.Capacitor.nativePromise("UpdateBridge", method, options);
  }
  let pendingApkUrl = null;

  $("#appVersionText").textContent =
    "현재 버전: v" + APP_VERSION_NAME + (typeof APP_VERSION !== "undefined" ? " (빌드: " + APP_VERSION + ")" : "");

  $("#btnCheckUpdate").addEventListener("click", async () => {
    if (pendingApkUrl) {
      if (IS_NATIVE_UPDATE) {
        callUpdateBridge("openExternal", { url: pendingApkUrl }).catch(() => {
          $("#updateStatus").textContent = "업데이트 파일을 여는 데 실패했습니다.";
        });
      } else {
        window.open(pendingApkUrl, "_blank");
      }
      return;
    }
    $("#updateStatus").textContent = "업데이트 확인 중...";
    try {
      const res = await fetch(UPDATE_MANIFEST_URL + "?t=" + Date.now());
      const info = await res.json();
      if (!info || typeof info.versionCode !== "number") {
        $("#updateStatus").textContent = "업데이트 정보를 확인하지 못했습니다.";
        return;
      }
      if (info.versionCode <= APP_VERSION_CODE) {
        $("#updateStatus").textContent = "이미 최신 버전입니다 (v" + APP_VERSION_NAME + ")";
        return;
      }
      pendingApkUrl = info.apkUrl;
      $("#btnCheckUpdate").textContent = "새 버전(" + (info.versionName || info.versionCode) + ") 다운로드하기";
      $("#updateStatus").textContent = "다시 눌러서 다운로드를 시작하세요.";
    } catch (e) {
      $("#updateStatus").textContent = "업데이트 확인에 실패했습니다. 네트워크를 확인해주세요.";
    }
  });

  function renderDriveStatus() {
    $("#driveEnabledToggle").checked = DriveBackup.isEnabled();
  }

  $("#driveEnabledToggle").addEventListener("change", (e) => {
    DriveBackup.setEnabled(e.target.checked);
    toast(e.target.checked ? "자동 저장을 켰습니다." : "자동 저장을 껐습니다.");
  });

  $("#btnSaveApiKeys").addEventListener("click", () => {
    BldReg.saveKeys({
      jusoKey: $("#jusoApiKey").value.trim(),
      dataGoKrKey: $("#dataGoKrApiKey").value.trim()
    });
    toast("API 키가 저장되었습니다.");
  });

  $("#aiEnabledToggle").addEventListener("change", (e) => {
    AiFill.setEnabled(e.target.checked);
    toast(e.target.checked ? "AI 자동 인식을 켰습니다." : "AI 자동 인식을 껐습니다.");
  });

  $("#changeHistoryEnabledToggle").addEventListener("change", (e) => {
    setChangeHistoryVisible(e.target.checked);
    toast(e.target.checked ? "변경이력 보기를 켰습니다." : "변경이력 보기를 껐습니다.");
  });

  // ---------- 자료 백업 / 복구 ----------
  // 거래처/점검/지적사항/스케줄(=Firebase의 공유 텍스트 자료)의 스냅샷을 zip으로 묶어 구글
  // 드라이브에 보관한다. 사진/첨부파일은 업로드 시점에 이미 각자 개별적으로 구글 드라이브에
  // 자동 저장되므로 여기 다시 담지 않는다(용량 낭비 + 중복). 이행완료보고서도 지적사항 데이터가
  // 있으면 언제든 다시 만들 수 있어 별도로 담지 않는다 - "다시 만들 수 없는 원본 텍스트"만 백업한다.
  async function collectBackupData() {
    const [sites, inspections, deficiencies, schedules, constructionJobs] = await Promise.all([
      FireDB.getAllSites(),
      FireDB.getAllInspections(),
      FireDB.getAllDeficiencies(),
      FireDB.getAllSchedules(),
      FireDB.getAllConstructionJobs(),
    ]);
    return { version: 1, exportedAt: new Date().toISOString(), company: await getCompanyProfile(), sites, inspections, deficiencies, schedules, constructionJobs };
  }

  function backupFilenameDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  $("#btnDataBackup").addEventListener("click", async () => {
    const btn = $("#btnDataBackup");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "백업 중...";
    $("#backupStatus").textContent = "";
    try {
      const data = await collectBackupData();
      const zip = new JSZip();
      zip.file("backup.json", JSON.stringify(data, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const filename = `${backupFilenameDate()}.zip`;
      await DriveBackup.uploadBackup(filename, blob);
      $("#backupStatus").textContent = `마지막 백업: ${filename}`;
      toast(`백업 완료: ${filename} (구글 드라이브에 저장됨)`, "success");
    } catch (err) {
      toast("백업에 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnDataRestore").addEventListener("click", async () => {
    const ok = await confirmDialog(
      "가장 최근 백업으로 복구할까요?\n" +
      "현재 거래처·점검·지적사항·스케줄·공사내역 자료가 백업 시점 내용으로 전부 바뀌며, 이 앱을 쓰는 모든 사람에게 적용됩니다.\n" +
      "되돌릴 수 없습니다."
    );
    if (!ok) return;
    const btn = $("#btnDataRestore");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "복구 중...";
    $("#backupStatus").textContent = "";
    try {
      const backups = await DriveBackup.listBackups();
      if (backups.length === 0) {
        toast("구글 드라이브에 백업 파일이 없습니다.", "error");
        return;
      }
      const latest = backups[0];
      btn.textContent = "다운로드 중...";
      const blob = await DriveBackup.downloadFile(latest.id);
      const zip = await JSZip.loadAsync(blob);
      const entry = zip.file("backup.json");
      if (!entry) throw new Error("백업 파일 형식이 올바르지 않습니다.");
      const data = JSON.parse(await entry.async("string"));

      btn.textContent = "복원 중...";
      for (const site of data.sites || []) await FireDB.addSite(site);
      for (const insp of data.inspections || []) await FireDB.addInspection(insp);
      for (const def of data.deficiencies || []) await FireDB.addDeficiency(def);
      for (const sched of data.schedules || []) {
        await FireDB.setScheduleSiteIds(sched.id, sched.siteIds || []);
        await FireDB.setScheduleConfirmed(sched.id, !!sched.confirmed);
      }
      for (const job of data.constructionJobs || []) await FireDB.addConstructionJob(job);
      if (data.company) await saveCompanyProfile(data.company);

      $("#backupStatus").textContent = `복구 완료: ${latest.name}`;
      toast(`복구 완료 (백업 파일: ${latest.name})`, "success");
      renderSettings();
    } catch (err) {
      toast("복구에 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnAuthLogout").addEventListener("click", () => {
    Auth.logout();
    $("#loginUsername").value = "";
    $("#loginPassword").value = "";
    $("#loginGate").classList.remove("hidden");
    showScreen("screen-home");
    toast("로그아웃되었습니다.");
  });

  $("#btnSaveCompany").addEventListener("click", async () => {
    const name = $("#companyName").value.trim() || DEFAULT_COMPANY.name;
    const address = $("#companyAddress").value.trim() || DEFAULT_COMPANY.address;
    const phone = $("#companyPhone").value.trim();
    const ceo = $("#companyCeo").value.trim();
    const bizRegNo = $("#companyBizRegNo").value.trim();
    const licenseNo = $("#companyLicenseNo").value.trim();
    await saveCompanyProfile({ name, address, phone, ceo, bizRegNo, licenseNo });
    toast("업체 정보가 저장되었습니다. (다른 사람에게도 바로 적용됩니다)");
  });

  // ================= 스케줄 관리 (날짜별 방문 예정/확정 업체) =================
  // 점검 기록(inspections)과는 무관한 가벼운 일정 - 날짜에 업체를 담아두고, 전화로 방문이
  // 확정되면 그 날짜 전체를 "확정"으로 표시한다(업체 개별 확정이 아니라 날짜 단위 확정).
  function scheduleDateStr(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // 법정 공휴일(대체공휴일 포함) - 설날/추석/부처님오신날처럼 음력 기준이라 해마다 날짜가 달라지는
  // 공휴일은 계산으로 구할 수 없어 연도별로 직접 채워둔다. 여기 없는 연도(2028년 이후 등)는
  // 달력에 공휴일 빨간색 표시만 안 될 뿐 나머지 기능에는 영향이 없다 - 해가 바뀌면 이 목록을 갱신한다.
  const KR_HOLIDAYS = new Set([
    // 2025
    "2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-03",
    "2025-05-05", "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-06",
    "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
    // 2026
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
    "2026-05-05", "2026-05-25", "2026-06-06", "2026-07-17", "2026-08-17",
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-05", "2026-10-09", "2026-12-25",
    // 2027
    "2027-01-01", "2027-02-06", "2027-02-08", "2027-02-09", "2027-03-01",
    "2027-05-05", "2027-05-13", "2027-06-06", "2027-07-19", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-25"
  ]);

  async function renderScheduleCalendar() {
    const year = scheduleCalDate.getFullYear();
    const month = scheduleCalDate.getMonth();
    $("#scheduleMonthLabel").textContent = `${year}년 ${month + 1}월`;

    const schedules = await FireDB.getAllSchedules();
    const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayISO();

    let cellsHtml = "";
    for (let i = 0; i < startWeekday; i++) {
      cellsHtml += `<div class="schedule-day-cell is-empty"></div>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = scheduleDateStr(year, month, day);
      const weekday = new Date(year, month, day).getDay();
      const sched = scheduleMap.get(dateStr);
      const count = sched ? sched.siteIds.length : 0;
      // 셀 배경(회색/파랑/노랑)은 그날의 방문 일정 상태를, 날짜 숫자 색(파랑/빨강)은 요일·공휴일을
      // 나타낸다 - 서로 다른 정보라서 겹쳐도 각자 구분되게 클래스를 따로 둔다.
      const classes = ["schedule-day-cell"];
      if (count > 0) classes.push("has-schedule");
      if (sched && sched.confirmed) classes.push("is-confirmed");
      if (dateStr === today) classes.push("is-today");
      if (dateStr === scheduleSelectedDate) classes.push("is-selected");
      const numClasses = ["schedule-day-num"];
      if (weekday === 6) numClasses.push("is-sat");
      if (weekday === 0 || KR_HOLIDAYS.has(dateStr)) numClasses.push("is-sun");
      cellsHtml += `
        <div class="${classes.join(" ")}" data-date="${dateStr}">
          <span class="${numClasses.join(" ")}">${day}</span>
          ${count > 0 ? `<span class="schedule-day-count">${count}곳</span>` : ""}
        </div>
      `;
    }
    $("#scheduleCalendarGrid").innerHTML = cellsHtml;
    $$("#scheduleCalendarGrid .schedule-day-cell:not(.is-empty)").forEach((el) => {
      el.addEventListener("click", () => selectScheduleDate(el.dataset.date));
    });
  }

  // 날짜를 선택할 때마다 그 날짜에 이미 저장된 업체 목록으로 "확인 전 임시 선택" 상태를 초기화한다 -
  // 업체 선택 목록에서 체크만 해두고 아직 저장(확인)하지 않은 상태를 달력 이동 시 버리기 위함.
  async function selectScheduleDate(date) {
    scheduleSelectedDate = date;
    const sched = await FireDB.getScheduleByDate(date);
    scheduleStagedIds = new Set(sched ? sched.siteIds : []);
    await refreshScheduleManage();
  }

  async function renderScheduleDayDetail() {
    const date = scheduleSelectedDate;
    const d = new Date(date + "T00:00:00");
    $("#scheduleSelectedDateLabel").textContent = `${date} (${WEEKDAY_LABEL[d.getDay()]}) 방문 예정 업체`;

    const [sched, sites] = await Promise.all([FireDB.getScheduleByDate(date), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const siteIds = sched ? sched.siteIds : [];
    const confirmed = !!(sched && sched.confirmed);

    const list = $("#scheduleDayCompanyList");
    if (siteIds.length === 0) {
      list.innerHTML = `<div class="empty-state">아래 업체 목록에서 선택 후 "확인"을 누르면 여기에 표시됩니다.</div>`;
    } else {
      // 방문 순서(번호)를 직접 매길 수 있게 ▲▼로 배열 순서를 바꾼다 - 하루에 여러 업체를 도는 경우
      // 실제로 돌 순서대로 정렬해두면 편하다(사용자 요청). 순서는 siteIds 배열 순서 그대로.
      list.innerHTML = siteIds.map((id, idx) => `
        <div class="schedule-day-company-chip">
          <div class="schedule-day-company-reorder">
            <button type="button" class="schedule-reorder-btn" data-move="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>▲</button>
            <button type="button" class="schedule-reorder-btn" data-move="down" data-idx="${idx}" ${idx === siteIds.length - 1 ? "disabled" : ""}>▼</button>
          </div>
          <span class="schedule-day-company-name">${idx + 1}. ${escapeHtml(siteMap.has(id) ? siteMap.get(id).name : "삭제된 업체")}</span>
          <button type="button" class="schedule-day-company-remove" data-remove="${id}">×</button>
        </div>
      `).join("");
      $$("#scheduleDayCompanyList [data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.remove;
          await FireDB.removeSiteFromSchedule(date, id);
          scheduleStagedIds.delete(id);
          await refreshScheduleManage();
          toast("삭제했습니다.");
        });
      });
      $$("#scheduleDayCompanyList [data-move]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const newIdx = idx + (btn.dataset.move === "up" ? -1 : 1);
          if (newIdx < 0 || newIdx >= siteIds.length) return;
          const reordered = siteIds.slice();
          [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
          await FireDB.setScheduleSiteIds(date, reordered);
          await renderScheduleDayDetail();
        });
      });
    }

    $("#btnScheduleConfirm").classList.toggle("hidden", siteIds.length === 0 || confirmed);
    $("#btnScheduleUnconfirm").classList.toggle("hidden", !confirmed);
  }

  function scheduleCompanyPickRowHtml(s) {
    const checked = scheduleStagedIds.has(s.id);
    return `
      <div class="schedule-company-pick-row ${checked ? "is-added" : ""}" data-id="${s.id}">
        ${checked ? "☑" : "☐"} ${escapeHtml(s.name)}
      </div>
    `;
  }
  function bindScheduleCompanyPickRowClicks(container) {
    Array.from(container.querySelectorAll(".schedule-company-pick-row")).forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        if (scheduleStagedIds.has(id)) scheduleStagedIds.delete(id);
        else scheduleStagedIds.add(id);
        renderScheduleCompanyPickList();
      });
    });
  }

  // 업체 선택 목록은 클릭 즉시 저장하지 않고 scheduleStagedIds(임시 체크 상태)만 바꾼다 -
  // 실제로 그 날짜의 예정 업체로 저장되는 시점은 "확인" 버튼을 눌렀을 때뿐이다. 검색어가 있으면
  // 정렬/지역/이번달 상태와 무관하게 이름으로만 걸러진 평평한 목록을 보여준다(검색이 우선).
  async function renderScheduleCompanyPickList() {
    $("#btnSchedulePickSortByName").classList.toggle("active", schedulePickSortMode === "name");
    $("#btnSchedulePickSortByRegion").classList.toggle("active", schedulePickSortMode === "region");
    $("#btnSchedulePickFilterThisMonth").classList.toggle("active", schedulePickMonthOnly);

    const allSites = await FireDB.getAllSites();
    allSites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const sites = schedulePickMonthOnly ? allSites.filter(isSiteInCurrentMonth) : allSites;

    const list = $("#scheduleCompanyPickList");
    const term = scheduleCompanySearchTerm.trim();
    if (term) {
      const filtered = sites.filter((s) => s.name.includes(term));
      list.innerHTML = filtered.length === 0
        ? `<div class="empty-state">검색 결과가 없습니다.</div>`
        : filtered.map(scheduleCompanyPickRowHtml).join("");
      if (filtered.length > 0) bindScheduleCompanyPickRowClicks(list);
      return;
    }

    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">${schedulePickMonthOnly ? "이번 달 종합점검/작동점검 대상 거래처가 없습니다." : "등록된 업체가 없습니다."}</div>`;
      return;
    }

    if (schedulePickSortMode === "region") {
      if (schedulePickSelectedRegion) {
        const filtered = sites.filter((s) => classifyRegion(s.address) === schedulePickSelectedRegion);
        const backBtnHtml = `<button class="btn btn-secondary region-back-row" type="button">← 지역 목록으로 (${escapeHtml(schedulePickSelectedRegion)})</button>`;
        list.innerHTML = filtered.length === 0
          ? `${backBtnHtml}<div class="empty-state">이 지역에 등록된 현장이 없습니다.</div>`
          : backBtnHtml + filtered.map(scheduleCompanyPickRowHtml).join("");
        if (filtered.length > 0) bindScheduleCompanyPickRowClicks(list);
        list.querySelector(".region-back-row").addEventListener("click", () => {
          schedulePickSelectedRegion = null;
          renderScheduleCompanyPickList();
        });
        return;
      }
      const counts = new Map();
      sites.forEach((s) => {
        const region = classifyRegion(s.address);
        counts.set(region, (counts.get(region) || 0) + 1);
      });
      const daeguOrder = DAEGU_DISTRICTS.filter((g) => counts.has(g));
      const otherOrder = PROVINCE_PATTERNS.map(([, label]) => label).filter((l) => l !== "대구" && counts.has(l));
      const orderedRegions = [...daeguOrder, ...otherOrder];
      if (counts.has("대구 기타")) orderedRegions.push("대구 기타");
      if (counts.has("지역 미상")) orderedRegions.push("지역 미상");
      list.innerHTML = `<div class="region-grid">${orderedRegions.map((r) => `
        <button class="region-btn" data-region="${escapeHtml(r)}" type="button">
          <span class="region-btn-name">${escapeHtml(r)}</span>
          <span class="region-btn-count">${counts.get(r)}개</span>
        </button>
      `).join("")}</div>`;
      Array.from(list.querySelectorAll(".region-btn")).forEach((btn) => {
        btn.addEventListener("click", () => {
          schedulePickSelectedRegion = btn.dataset.region;
          renderScheduleCompanyPickList();
        });
      });
      return;
    }

    list.innerHTML = sites.map(scheduleCompanyPickRowHtml).join("");
    bindScheduleCompanyPickRowClicks(list);
  }

  $("#btnSchedulePickSortByName").addEventListener("click", () => {
    schedulePickSortMode = "name";
    schedulePickSelectedRegion = null;
    renderScheduleCompanyPickList();
  });
  $("#btnSchedulePickSortByRegion").addEventListener("click", () => {
    schedulePickSortMode = "region";
    renderScheduleCompanyPickList();
  });
  $("#btnSchedulePickFilterThisMonth").addEventListener("click", () => {
    schedulePickMonthOnly = !schedulePickMonthOnly;
    renderScheduleCompanyPickList();
  });

  async function refreshScheduleManage() {
    await Promise.all([renderScheduleCalendar(), renderScheduleDayDetail(), renderScheduleCompanyPickList()]);
  }

  $("#btnSchedulePrevMonth").addEventListener("click", async () => {
    scheduleCalDate = new Date(scheduleCalDate.getFullYear(), scheduleCalDate.getMonth() - 1, 1);
    await renderScheduleCalendar();
  });
  $("#btnScheduleNextMonth").addEventListener("click", async () => {
    scheduleCalDate = new Date(scheduleCalDate.getFullYear(), scheduleCalDate.getMonth() + 1, 1);
    await renderScheduleCalendar();
  });
  $("#scheduleCompanySearch").addEventListener("input", (e) => {
    scheduleCompanySearchTerm = e.target.value;
    renderScheduleCompanyPickList();
  });
  $("#btnScheduleAddCompanies").addEventListener("click", async () => {
    await FireDB.setScheduleSiteIds(scheduleSelectedDate, Array.from(scheduleStagedIds));
    await refreshScheduleManage();
    toast("예정으로 등록되었습니다.");
  });
  $("#btnScheduleConfirm").addEventListener("click", async () => {
    await FireDB.setScheduleConfirmed(scheduleSelectedDate, true);
    await refreshScheduleManage();
    toast("일정을 확정했습니다.");
  });
  $("#btnScheduleUnconfirm").addEventListener("click", async () => {
    await FireDB.setScheduleConfirmed(scheduleSelectedDate, false);
    await refreshScheduleManage();
    toast("확정을 취소했습니다.");
  });

  // ================= 초기화 =================
  // 지적사항 "설비" 입력칸의 자동완성 후보 (소방시설 표준 분류) - 체크리스트 기능과는 무관하게 유지.
  const DEFICIENCY_CATEGORY_SUGGESTIONS = ["소화설비", "경보설비", "피난구조설비", "소화용수설비", "소화활동설비", "전기 및 기타"];

  function bootApp() {
    $("#bootLoading").classList.add("hidden");
    showScreen("screen-home");
    $("#categoryList").innerHTML = DEFICIENCY_CATEGORY_SUGGESTIONS.map((c) => `<option value="${escapeHtml(c)}">`).join("");
    $("#appVersionTag").textContent = typeof APP_VERSION !== "undefined" ? "v" + APP_VERSION : "";
    renderSites().catch(reportLoadFailure);
    renderHomeTodo().catch(reportLoadFailure);
  }

  // 이제 모든 자료(거래처·점검기록·지적사항·스케줄)가 로그인한 사람만 읽고 쓸 수 있는 공용
  // 온라인 저장소(Firebase)에 있어서, 예전과 달리 사무실 Wi-Fi/로컬에서도 로그인이 항상 필요하다.
  async function attemptLogin() {
    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;
    $("#btnLogin").disabled = true;
    const ok = await Auth.tryLogin(username, password);
    $("#btnLogin").disabled = false;
    if (ok) {
      $("#loginError").classList.add("hidden");
      $("#loginGate").classList.add("hidden");
      bootApp();
    } else {
      $("#loginError").classList.remove("hidden");
      $("#loginPassword").value = "";
      $("#loginPassword").focus();
    }
  }
  $("#btnLogin").addEventListener("click", attemptLogin);
  $("#loginUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });
  $("#loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });

  // Auth.onReady() 자체가 (알 수 없는 이유로) 끝없이 멈출 가능성까지 대비해, 20초 안에 응답이
  // 없으면 로그인 화면으로 강제 전환한다 - "로딩 중" 표시만 영원히 뜨는 상황을 막기 위함.
  const authReadyWithTimeout = Promise.race([
    Auth.onReady(),
    new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
  ]);
  authReadyWithTimeout.then((loggedIn) => {
    if (loggedIn) {
      bootApp();
    } else {
      $("#bootLoading").classList.add("hidden");
      $("#loginGate").classList.remove("hidden");
      $("#loginUsername").focus();
    }
  }).catch(() => {
    $("#bootLoading").classList.add("hidden");
    $("#loginGate").classList.remove("hidden");
    $("#loginUsername").focus();
  });
})();
