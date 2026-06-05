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

let safetyData = [
  {
    type: "CCTV",
    name: "제주시청 인근 CCTV",
    address: "제주시 광양9길 10",
    lat: 33.5008,
    lng: 126.5312,
  },
  {
    type: "가로등",
    name: "중앙로 가로등",
    address: "제주시 중앙로",
    lat: 33.4996,
    lng: 126.5318,
  },
  {
    type: "파출소",
    name: "제주동부경찰서",
    address: "제주시 동광로",
    lat: 33.5016,
    lng: 126.5352,
  },
];

async function loadKakaoMap() {
  const response = await fetch("http://localhost:3000/config");
  const config = await response.json();

  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${config.kakaoJsKey}&libraries=services&autoload=false`;

  script.onload = function () {
    kakao.maps.load(function () {
      initMap();
    });
  };

  document.head.appendChild(script);
}

function initMap() {
  const container = document.getElementById("map");

  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(33.4996, 126.5312),
    level: 5,
  });

  geocoder = new kakao.maps.services.Geocoder();

  showSafetyMarkers(safetyData);
  loadPublicSafetyData();
}

async function searchSafeRoute() {
  const start = document.getElementById("startInput").value.trim();
  const end = document.getElementById("endInput").value.trim();

  const resultBox = document.getElementById("result");

  if (!start || !end) {
    resultBox.innerHTML = "<p>출발지와 도착지를 입력해주세요.</p>";
    return;
  }

  geocoder.addressSearch(start, function (startResult, startStatus) {
    if (startStatus !== kakao.maps.services.Status.OK) {
      resultBox.innerHTML = "<p>출발지를 찾을 수 없습니다.</p>";
      return;
    }

    geocoder.addressSearch(end, async function (endResult, endStatus) {
      if (endStatus !== kakao.maps.services.Status.OK) {
        resultBox.innerHTML = "<p>도착지를 찾을 수 없습니다.</p>";
        return;
      }

      const startLatLng = new kakao.maps.LatLng(
        startResult[0].y,
        startResult[0].x,
      );

      const endLatLng = new kakao.maps.LatLng(endResult[0].y, endResult[0].x);

      showStartEndMarkers(startLatLng, endLatLng);

      moveMapToRoute(startLatLng, endLatLng);

      await getKakaoRoute(startLatLng, endLatLng);

      const nearbyData = getNearbySafetyDataByRoute();

      showSafetyMarkers(nearbyData);

      showRouteResult(start, end, nearbyData);
    });
  });
}

async function getKakaoRoute(startLatLng, endLatLng) {
  const origin = `${startLatLng.getLng()},${startLatLng.getLat()}`;

  const destination = `${endLatLng.getLng()},${endLatLng.getLat()}`;

  try {
    const response = await fetch(
      `http://localhost:3000/route?origin=${origin}&destination=${destination}`,
    );

    const data = await response.json();

    if (!response.ok || !data.routes) {
      drawRouteLine(startLatLng, endLatLng);
      return;
    }

    drawKakaoRoute(data);

    routeInfo = getRouteSummary(data);
  } catch (error) {
    console.error(error);
    drawRouteLine(startLatLng, endLatLng);
  }
}

function drawKakaoRoute(data) {
  if (routeLine) routeLine.setMap(null);

  routePath = [];

  const roads = data.routes[0].sections[0].roads;

  roads.forEach((road) => {
    const vertexes = road.vertexes;

    for (let i = 0; i < vertexes.length; i += 2) {
      const lng = vertexes[i];
      const lat = vertexes[i + 1];

      const latlng = new kakao.maps.LatLng(lat, lng);

      routePath.push(latlng);
    }
  });

  routeLine = new kakao.maps.Polyline({
    path: routePath,
    strokeWeight: 5,
    strokeColor: "#1f5eff",
    strokeOpacity: 0.85,
    strokeStyle: "solid",
  });

  routeLine.setMap(map);
}

function drawRouteLine(startLatLng, endLatLng) {
  if (routeLine) routeLine.setMap(null);

  routeLine = new kakao.maps.Polyline({
    path: [startLatLng, endLatLng],
    strokeWeight: 5,
    strokeColor: "#1f5eff",
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
    });

    safetyMarkers.push(marker);

    const infoWindow = new kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px;font-size:13px;">
          <strong>${item.type}</strong><br>
          ${item.name}
        </div>
      `,
    });

    kakao.maps.event.addListener(marker, "click", function () {
      infoWindow.open(map, marker);
    });
  });
}

function clearSafetyMarkers() {
  safetyMarkers.forEach((marker) => {
    marker.setMap(null);
  });

  safetyMarkers = [];
}

function moveMapToRoute(startLatLng, endLatLng) {
  const bounds = new kakao.maps.LatLngBounds();

  bounds.extend(startLatLng);
  bounds.extend(endLatLng);

  map.setBounds(bounds);
}

function getNearbySafetyDataByRoute() {
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
    .filter((item) => item.distance <= 300);
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

    <div class="summary-box">
      <div class="summary-item">
        <strong>CCTV</strong>
        <span>${summary.CCTV}개</span>
      </div>

      <div class="summary-item">
        <strong>가로등</strong>
        <span>${summary.가로등}개</span>
      </div>

      <div class="summary-item">
        <strong>파출소</strong>
        <span>${summary.파출소}개</span>
      </div>
    </div>
  `;

  nearbyData.forEach((item) => {
    html += `
      <div class="card">
        <h4>${item.type} - ${item.name}</h4>
        <p>${item.address}</p>
        <p>경로와의 거리: ${item.distance}m</p>
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

  return Math.min(score, 100);
}

function getSafetyGrade(score) {
  if (score >= 85) return "매우 안전";
  if (score >= 70) return "안전";
  if (score >= 50) return "보통";
  return "주의 필요";
}

function getSafetyComment(score) {
  if (score >= 85) {
    return "안전시설이 충분히 확보된 경로입니다.";
  }

  if (score >= 70) {
    return "비교적 안전한 이동 경로입니다.";
  }

  if (score >= 50) {
    return "일부 구간에서 주의가 필요합니다.";
  }

  return "야간 이동 시 주의가 필요합니다.";
}

function getSafetySummary(data) {
  return {
    CCTV: data.filter((d) => d.type === "CCTV").length,
    가로등: data.filter((d) => d.type === "가로등").length,
    파출소: data.filter((d) => d.type === "파출소").length,
  };
}

function getScoreClass(score) {
  if (score >= 85) return "score-very-safe";
  if (score >= 70) return "score-safe";
  if (score >= 50) return "score-normal";
  return "score-danger";
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
async function loadPublicSafetyData() {
  try {
    const response = await fetch("http://localhost:3000/safety-lights?perPage=500");
    const lights = await response.json();

    if (!Array.isArray(lights)) {
      console.error("공공데이터 응답이 배열이 아님:", lights);
      return;
    }

    safetyData = [
      ...safetyData,
      ...lights,
    ];

    showSafetyMarkers(safetyData);
  } catch (error) {
    console.error("공공데이터 불러오기 실패:", error);
  }
}

window.addEventListener("load", loadKakaoMap);
