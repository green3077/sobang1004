// 근처 맛집 추천 - 카카오 로컬 API(developers.kakao.com, 무료 REST API 키 필요).
// 주소 -> 좌표 변환(주소 검색) 후 그 좌표 주변 음식점(카테고리 코드 FD6)을 거리순으로 조회한다.
const KakaoLocal = (() => {
  const KEY = "fireInspectionKakaoApiKey";

  function getKey() {
    return localStorage.getItem(KEY) || "";
  }

  function saveKey(key) {
    localStorage.setItem(KEY, key || "");
  }

  async function callApi(url) {
    const key = getKey();
    if (!key) {
      const err = new Error("missing_key");
      err.code = "missing_key";
      throw err;
    }
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!res.ok) throw new Error("kakao_http_" + res.status);
    return res.json();
  }

  // 주소 -> 좌표(x=경도, y=위도). 도로명/지번 주소 모두 지원 - 못 찾으면 null.
  async function geocodeAddress(address) {
    const params = new URLSearchParams({ query: address });
    const data = await callApi(`https://dapi.kakao.com/v2/local/search/address.json?${params.toString()}`);
    const doc = data.documents && data.documents[0];
    if (!doc) return null;
    return { x: doc.x, y: doc.y };
  }

  // 좌표 주변 음식점(카테고리 FD6) - 거리순 상위 limit개. radius 단위: 미터(최대 20000).
  async function searchNearbyRestaurants(x, y, radius, limit) {
    const params = new URLSearchParams({
      category_group_code: "FD6",
      x: String(x),
      y: String(y),
      radius: String(radius || 1500),
      sort: "distance",
      size: String(limit || 3)
    });
    const data = await callApi(`https://dapi.kakao.com/v2/local/search/category.json?${params.toString()}`);
    return (data.documents || []).map((d) => ({
      name: d.place_name,
      category: (d.category_name || "").split(">").pop().trim(),
      distance: parseInt(d.distance, 10) || 0,
      phone: d.phone || "",
      address: d.road_address_name || d.address_name || "",
      url: d.place_url
    }));
  }

  // 카카오 로컬 API는 가격 정보를 제공하지 않는다 - "1인 1만원 이하"를 정확히 걸러낼 방법이
  // 없어서, 대신 이름만으로도 보통 비싼 축에 드는 카테고리(고기/횟집/오마카세 등)를 걸러내는
  // 방식으로 최대한 저렴한 식당 위주로 추천한다(완벽한 가격 필터는 아님).
  const EXPENSIVE_CATEGORY_KEYWORDS = [
    "고기", "횟집", "참치", "일식", "오마카세", "스테이크", "브런치", "한우",
    "장어", "전복", "코스요리", "이자카야", "요리주점", "샤브샤브", "뷔페"
  ];

  function filterAffordable(restaurants) {
    const cheap = restaurants.filter((r) => !EXPENSIVE_CATEGORY_KEYWORDS.some((kw) => r.category.includes(kw)));
    return cheap.length ? cheap : restaurants; // 다 걸러지면 아예 안 보여주는 것보단 원래 목록을 보여준다.
  }

  // 주소 하나로 바로 근처 맛집까지 - 화면에서 쓰는 진입점. 저렴해 보이는 곳 위주로 넉넉히 뽑은 뒤
  // 걸러서 limit개만 돌려준다.
  async function recommendNearAddress(address, radius, limit) {
    const coord = await geocodeAddress(address);
    if (!coord) {
      const err = new Error("address_not_found");
      err.code = "address_not_found";
      throw err;
    }
    const size = Math.min(15, Math.max((limit || 3) * 5, 15));
    const found = await searchNearbyRestaurants(coord.x, coord.y, radius, size);
    return filterAffordable(found).slice(0, limit || 3);
  }

  return { getKey, saveKey, geocodeAddress, searchNearbyRestaurants, recommendNearAddress };
})();
