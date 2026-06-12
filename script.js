let map;
let geocoder;

let routeLine = null;
let routeInfo = null;
let routePath = [];

let startMarker = null;
let endMarker = null;

let startInfoWindow = null;
let endInfoWindow = null;

let safetyMarkers = [];
let currentLocationLatLng = null;
let currentNearbyData = [];

let safetyData = [];

async function loadKakaoMap() {
  if (document.querySelector('script[src*="dapi.kakao.com"]')) {
    return;
  }

  try {
    const response = await fetch("/config");
    const config = await response.json();

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${config.kakaoJsKey}&libraries=services&autoload=false`;

    script.onload = function () {
      kakao.maps.load(function () {
        initMap();
      });
    };

    script.onerror = function () {
      console.error("카카오 SDK 로드 실패");
    };

    document.head.appendChild(script);
  } catch (error) {
    console.error("카카오맵 로딩 실패:", error);
  }
}

window.addEventListener("DOMContentLoaded", loadKakaoMap);

async function initMap() {
  const container = document.getElementById("map");

  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 5,
  });

  geocoder = new kakao.maps.services.Geocoder();

  const lights = await loadPublicSafetyData();
  safetyData = [...safetyData, ...lights];

  console.log("불러온 안전시설 전체:", safetyData.length);
  console.log(
    "CCTV:",
    safetyData.filter((item) => item.type === "CCTV").length,
  );
  console.log(
    "경찰관서:",
    safetyData.filter((item) => item.type === "파출소").length,
  );
}

async function loadPublicSafetyData() {
  try {
    const response = await fetch("/safety-data");
    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error("JSON 변환 실패. 서버 응답:", text.slice(0, 300));
      return [];
    }

    if (!response.ok) {
      console.error("공공데이터 응답 오류:", data);
      return [];
    }

    if (!Array.isArray(data)) {
      console.error("공공데이터 응답이 배열이 아님:", data);
      return [];
    }

    return data;
  } catch (error) {
    console.error("공공데이터 불러오기 실패:", error);
    return [];
  }
}

function useCurrentLocation() {
  const resultBox = document.getElementById("result");

  if (!navigator.geolocation) {
    resultBox.innerHTML =
      "<p>현재 위치 기능을 지원하지 않는 브라우저입니다.</p>";
    return;
  }

  showLoading("현재 위치를 확인하고 있습니다...");

  navigator.geolocation.getCurrentPosition(
    function (position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      currentLocationLatLng = new kakao.maps.LatLng(lat, lng);
      document.getElementById("startInput").value = "현재 위치";

      if (startMarker) startMarker.setMap(null);
      if (startInfoWindow) startInfoWindow.close();

      startMarker = new kakao.maps.Marker({
        map: map,
        position: currentLocationLatLng,
      });

      startInfoWindow = new kakao.maps.InfoWindow({
        content: `<div class="marker-label">현재 위치</div>`,
      });

      startInfoWindow.open(map, startMarker);
      map.setCenter(currentLocationLatLng);

      hideLoading();
      resultBox.innerHTML =
        "<p>현재 위치가 출발지로 설정되었습니다. 도착지를 입력해주세요.</p>";
    },
    function () {
      hideLoading();
      resultBox.innerHTML =
        "<p>현재 위치를 가져오지 못했습니다. 위치 권한을 허용해주세요.</p>";
    },
  );
}

async function searchSafeRoute() {
  if (!map || !geocoder) {
    alert("카카오맵이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
    console.error("map/geocoder 초기화 실패", { map, geocoder });
    return;
  }

  const start = document.getElementById("startInput").value.trim();
  const end = document.getElementById("endInput").value.trim();
  const resultBox = document.getElementById("result");

  if (!start || !end) {
    resultBox.innerHTML = "<p>출발지와 도착지를 모두 입력해주세요.</p>";
    return;
  }

  showLoading("주소를 검색하고 있습니다...");

  if (start === "현재 위치" && currentLocationLatLng) {
    geocoder.addressSearch(end, async function (endResult, endStatus) {
      if (endStatus !== kakao.maps.services.Status.OK) {
        hideLoading();
        resultBox.innerHTML = "<p>도착지를 찾을 수 없습니다.</p>";
        return;
      }

      const endLatLng = new kakao.maps.LatLng(endResult[0].y, endResult[0].x);

      await handleRouteSearch(
        currentLocationLatLng,
        endLatLng,
        "현재 위치",
        end,
      );
    });

    return;
  }

  geocoder.addressSearch(start, function (startResult, startStatus) {
    if (startStatus !== kakao.maps.services.Status.OK) {
      hideLoading();
      resultBox.innerHTML = "<p>출발지를 찾을 수 없습니다.</p>";
      return;
    }

    geocoder.addressSearch(end, async function (endResult, endStatus) {
      if (endStatus !== kakao.maps.services.Status.OK) {
        hideLoading();
        resultBox.innerHTML = "<p>도착지를 찾을 수 없습니다.</p>";
        return;
      }

      const startLatLng = new kakao.maps.LatLng(
        startResult[0].y,
        startResult[0].x,
      );
      const endLatLng = new kakao.maps.LatLng(endResult[0].y, endResult[0].x);

      await handleRouteSearch(startLatLng, endLatLng, start, end);
    });
  });
}

async function handleRouteSearch(startLatLng, endLatLng, startName, endName) {
  showStartEndMarkers(startLatLng, endLatLng);
  moveMapToRoute(startLatLng, endLatLng);

  showLoading("실제 이동 경로를 불러오고 있습니다...");
  const routeData = await getKakaoRoute(startLatLng, endLatLng);

  if (routeData) {
    drawKakaoRoute(routeData);
  }

  showLoading("경로 주변 안전시설을 분석하고 있습니다...");
  const nearbyData = getNearbySafetyDataByRoute();

  const score = calculateSafetyScore(nearbyData);
  const routeColor = getRouteColorByScore(score);

  if (routeData) {
    drawKakaoRoute(routeData, routeColor);
  } else {
    drawRouteLine(startLatLng, endLatLng, routeColor);
  }

  currentNearbyData = nearbyData;
  showSafetyMarkers(currentNearbyData);
  showRouteResult(startName, endName, nearbyData);

  hideLoading();
}

async function getKakaoRoute(startLatLng, endLatLng) {
  const origin = `${startLatLng.getLng()},${startLatLng.getLat()}`;
  const destination = `${endLatLng.getLng()},${endLatLng.getLat()}`;

  try {
    const response = await fetch(
      `/route?origin=${origin}&destination=${destination}`,
    );

    const data = await response.json();

    if (!response.ok || !data.routes) {
      console.error("길찾기 실패:", data);
      drawRouteLine(startLatLng, endLatLng);
      routeInfo = null;
      routePath = [startLatLng, endLatLng];
      return null;
    }

    routeInfo = getRouteSummary(data);
    return data;
  } catch (error) {
    console.error("길찾기 서버 오류:", error);
    drawRouteLine(startLatLng, endLatLng);
    routeInfo = null;
    routePath = [startLatLng, endLatLng];
    return null;
  }
}

function drawKakaoRoute(data, color = "#1f5eff") {
  if (routeLine) routeLine.setMap(null);

  routePath = [];

  const sections = data.routes[0].sections;

  sections.forEach((section) => {
    section.roads.forEach((road) => {
      const vertexes = road.vertexes;

      for (let i = 0; i < vertexes.length; i += 2) {
        const lng = vertexes[i];
        const lat = vertexes[i + 1];

        routePath.push(new kakao.maps.LatLng(lat, lng));
      }
    });
  });

  routeLine = new kakao.maps.Polyline({
    path: routePath,
    strokeWeight: 6,
    strokeColor: color,
    strokeOpacity: 0.85,
    strokeStyle: "solid",
  });

  routeLine.setMap(map);
}

function drawRouteLine(startLatLng, endLatLng, color = "#1f5eff") {
  if (routeLine) routeLine.setMap(null);

  routePath = [startLatLng, endLatLng];

  routeLine = new kakao.maps.Polyline({
    path: routePath,
    strokeWeight: 6,
    strokeColor: color,
    strokeOpacity: 0.8,
    strokeStyle: "solid",
  });

  routeLine.setMap(map);
}

function showStartEndMarkers(startLatLng, endLatLng) {
  if (startMarker) startMarker.setMap(null);
  if (endMarker) endMarker.setMap(null);
  if (startInfoWindow) startInfoWindow.close();
  if (endInfoWindow) endInfoWindow.close();

  startMarker = new kakao.maps.Marker({
    map: map,
    position: startLatLng,
  });

  endMarker = new kakao.maps.Marker({
    map: map,
    position: endLatLng,
  });

  startInfoWindow = new kakao.maps.InfoWindow({
    content: `<div class="marker-label">출발</div>`,
  });

  endInfoWindow = new kakao.maps.InfoWindow({
    content: `<div class="marker-label">도착</div>`,
  });

  startInfoWindow.open(map, startMarker);
  endInfoWindow.open(map, endMarker);
}

function showSafetyMarkers(data) {
  clearSafetyMarkers();

  data.forEach((item) => {
    const marker = new kakao.maps.Marker({
      map: map,
      position: new kakao.maps.LatLng(item.lat, item.lng),
      image: getMarkerImage(item.type),
    });

    safetyMarkers.push(marker);

    const infoWindow = new kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px;font-size:13px;">
          <strong>${item.type}</strong><br>
          ${item.name}<br>
          ${item.address || ""}
        </div>
      `,
    });

    kakao.maps.event.addListener(marker, "click", function () {
      infoWindow.open(map, marker);
    });
  });
}

function clearSafetyMarkers() {
  safetyMarkers.forEach((marker) => marker.setMap(null));
  safetyMarkers = [];
}

function getMarkerImage(type) {
  let imageSrc =
    "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png";

  if (type === "CCTV") {
    imageSrc =
      "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png";
  }

  if (type === "가로등") {
    imageSrc =
      "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_yellow.png";
  }

  if (type === "파출소") {
    imageSrc =
      "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png";
  }

  const imageSize = new kakao.maps.Size(24, 35);
  return new kakao.maps.MarkerImage(imageSrc, imageSize);
}

function moveMapToRoute(startLatLng, endLatLng) {
  const bounds = new kakao.maps.LatLngBounds();

  bounds.extend(startLatLng);
  bounds.extend(endLatLng);

  if (routePath.length > 0) {
    routePath.forEach((point) => bounds.extend(point));
  }

  map.setBounds(bounds);
}

function getNearbySafetyDataByRoute() {
  if (!routePath || routePath.length === 0) {
    return [];
  }

  const range = routeInfo && routeInfo.distance > 100000 ? 3000 : 300;

  return safetyData
    .map((item) => {
      let minDistance = Infinity;

      routePath.forEach((point) => {
        const distance = getDistance(
          point.getLat(),
          point.getLng(),
          item.lat,
          item.lng,
        );

        if (distance < minDistance) {
          minDistance = distance;
        }
      });

      return {
        ...item,
        distance: Math.round(minDistance),
      };
    })
    .filter((item) => item.distance <= range);
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const rad = Math.PI / 180;

  const φ1 = lat1 * rad;
  const φ2 = lat2 * rad;
  const Δφ = (lat2 - lat1) * rad;
  const Δλ = (lng2 - lng1) * rad;

  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function showRouteResult(start, end, nearbyData) {
  const resultBox = document.getElementById("result");

  const score = calculateSafetyScore(nearbyData);
  const grade = getSafetyGrade(score);
  const comment = getSafetyComment(score);
  const summary = getSafetySummary(nearbyData);
  const scoreClass = getScoreClass(score);

  let html = `
    <h2>안심 경로 분석 결과</h2>

    <p><strong>출발지:</strong> ${start}</p>
    <p><strong>도착지:</strong> ${end}</p>

    ${
      routeInfo
        ? `
      <p><strong>총 이동 거리:</strong> ${formatDistance(routeInfo.distance)}</p>
      <p><strong>예상 소요 시간:</strong> ${formatDuration(routeInfo.duration)}</p>
    `
        : ""
    }

    <div class="score-card ${scoreClass}">
      <p>안전 점수</p>
      <strong>${score}점</strong>
      <span>${grade}</span>
    </div>

    <p><strong>분석 의견:</strong> ${comment}</p>
    <p>경로 주변 안전시설 ${nearbyData.length}개를 분석했습니다.</p>

    <div class="summary-box">
      <div class="summary-item">
        <strong>CCTV</strong>
        <span>${summary.CCTV}개</span>
      </div>
      <div class="summary-item">
        <strong>가로등/보안등</strong>
        <span>${summary.가로등}개</span>
      </div>
      <div class="summary-item">
        <strong>파출소</strong>
        <span>${summary.파출소}개</span>
      </div>
    </div>

    <h3>주변 안전시설 목록</h3>
  `;

  if (nearbyData.length === 0) {
    html += `<p>경로 주변에서 분석 가능한 안전시설을 찾지 못했습니다.</p>`;
  }

  nearbyData.forEach((item) => {
    html += `
      <div class="card">
        <h4>${item.type} - ${item.name}</h4>
        <p>${item.address || "주소 정보 없음"}</p>
        <p>경로와의 최단 거리: 약 ${item.distance}m</p>
      </div>
    `;
  });

  resultBox.innerHTML = html;
}

function calculateSafetyScore(data) {
  let score = 40;

  data.forEach((item) => {
    let point = 0;

    if (item.type === "CCTV") point = 12;
    if (item.type === "가로등") point = 8;
    if (item.type === "파출소") point = 20;

    if (item.distance <= 200) {
      point += 8;
    } else if (item.distance <= 500) {
      point += 4;
    }

    score += point;
  });

  return Math.min(Math.max(score, 0), 100);
}

function getSafetyGrade(score) {
  if (score >= 85) return "매우 안전";
  if (score >= 70) return "안전";
  if (score >= 50) return "보통";
  return "주의 필요";
}

function getSafetyComment(score) {
  if (score >= 85) {
    return "경로 주변에 안전시설이 충분히 분포되어 있어 비교적 안전한 경로입니다.";
  }

  if (score >= 70) {
    return "주변 안전시설이 어느 정도 확보되어 있어 일반적인 이동에 적합합니다.";
  }

  if (score >= 50) {
    return "일부 구간에서 안전시설이 부족할 수 있으므로 주의가 필요합니다.";
  }

  return "경로 주변 안전시설이 부족하여 야간 이동 시 주의가 필요합니다.";
}

function getSafetySummary(data) {
  return {
    CCTV: data.filter((item) => item.type === "CCTV").length,
    가로등: data.filter((item) => item.type === "가로등").length,
    파출소: data.filter((item) => item.type === "파출소").length,
  };
}

function getScoreClass(score) {
  if (score >= 85) return "score-very-safe";
  if (score >= 70) return "score-safe";
  if (score >= 50) return "score-normal";
  return "score-danger";
}

function getRouteColorByScore(score) {
  if (score >= 85) return "#16a34a";
  if (score >= 70) return "#1f5eff";
  if (score >= 50) return "#f59e0b";
  return "#dc2626";
}

function getRouteSummary(data) {
  const summary = data.routes[0].summary;

  return {
    distance: summary.distance,
    duration: summary.duration,
  };
}

function formatDistance(meter) {
  if (meter >= 1000) {
    return (meter / 1000).toFixed(1) + "km";
  }

  return `${meter}m`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);

  if (minutes >= 60) {
    const hour = Math.floor(minutes / 60);
    const min = minutes % 60;

    return `${hour}시간 ${min}분`;
  }

  return `${minutes}분`;
}

function showLoading(message = "경로와 안전시설을 분석하고 있습니다...") {
  const loading = document.getElementById("loading");

  if (!loading) return;

  loading.querySelector("p").textContent = message;
  loading.classList.remove("hidden");
}

function hideLoading() {
  const loading = document.getElementById("loading");

  if (!loading) return;

  loading.classList.add("hidden");
}

function filterSafetyMarkers(type) {
  if (!currentNearbyData.length) {
    alert("먼저 안전 경로를 조회해주세요.");
    return;
  }

  if (type === "전체") {
    showSafetyMarkers(currentNearbyData);
    return;
  }

  const filtered = currentNearbyData.filter((item) => item.type === type);

  showSafetyMarkers(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
  loadKakaoMap();
});
