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

  // 주소 하나로 바로 근처 맛집까지 - 화면에서 쓰는 진입점.
  async function recommendNearAddress(address, radius, limit) {
    const coord = await geocodeAddress(address);
    if (!coord) {
      const err = new Error("address_not_found");
      err.code = "address_not_found";
      throw err;
    }
    return searchNearbyRestaurants(coord.x, coord.y, radius, limit);
  }

  return { getKey, saveKey, geocodeAddress, searchNearbyRestaurants, recommendNearAddress };
})();
