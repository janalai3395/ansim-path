const express = require("express");
const cors = require("cors");
require("dotenv").config();
const iconv = require("iconv-lite");

const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const LIGHTS_FILE = path.join(DATA_DIR, "safety_lights.json");

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/config", (req, res) => {
  res.json({
    kakaoJsKey: process.env.KAKAO_JS_KEY,
  });
});

app.get("/route", async (req, res) => {
  const { origin, destination } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({
      message: "origin과 destination 값이 필요합니다.",
    });
  }

  const url =
    `https://apis-navi.kakaomobility.com/v1/directions` +
    `?origin=${origin}` +
    `&destination=${destination}` +
    `&priority=RECOMMEND` +
    `&summary=false`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "카카오 길찾기 API 호출 실패",
      error: error.message,
    });
  }
});

app.get("/safety-lights", (req, res) => {
  try {
    if (!fs.existsSync(LIGHTS_FILE)) {
      return res.status(404).json({
        message: "safety_lights.json 없음",
      });
    }

    const rawData = fs.readFileSync(LIGHTS_FILE, "utf-8");

    if (!rawData.trim()) {
      return res.status(500).json({
        message: "safety_lights.json이 비어있음",
      });
    }

    const lights = JSON.parse(rawData);

    res.json(lights);
  } catch (error) {
    console.error("JSON 읽기 오류:", error);

    res.status(500).json({
      message: "JSON 읽기 실패",
      error: error.message,
    });
  }
});

app.get("/safety-data", async (req, res) => {
  try {
    console.log("=== /safety-data 요청 시작 ===");
    let lights = [];
    let cctvs = [];
    let police = [];

    // 보안등
    if (fs.existsSync(LIGHTS_FILE)) {
      const rawLights = fs.readFileSync(LIGHTS_FILE, "utf-8");

      if (rawLights.trim()) {
        lights = JSON.parse(rawLights);
      }
    }

    // CCTV
    try {
      console.log("CCTV 로드 시도 중...");
      cctvs = await loadCctvData();
      console.log("CCTV 로드 성공:", cctvs.length);
    } catch (error) {
      console.error("CCTV 로드 실패:", error.message, error);
    }

    // 경찰관서
    try {
      police = loadPoliceData();
    } catch (error) {
      console.error("경찰관서 로드 실패:", error.message);
    }

    console.log("보안등:", lights.length);
    console.log("CCTV:", cctvs.length);
    console.log("경찰관서:", police.length);
    console.log("=== /safety-data 요청 완료 ===");

    res.json([...lights, ...cctvs, ...police]);
  } catch (error) {
    console.error("안전시설 데이터 로드 실패:", error);

    res.status(500).json({
      message: "안전시설 데이터 로드 실패",
      error: error.message,
    });
  }
});

async function collectSafetyLights() {
  let allData = [];
  let page = 1;

  const perPage = 1000;
  const maxPage = 20;

  while (true) {
    const url =
      `https://api.data.go.kr/openapi/tn_pubr_public_scrty_lmp_api` +
      `?serviceKey=${process.env.PUBLIC_DATA_KEY}` +
      `&pageNo=${page}` +
      `&numOfRows=${perPage}` +
      `&type=json`;

    const response = await fetch(url);
    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error("JSON 변환 실패");
      break;
    }

    const items = data.response?.body?.items || [];

    if (items.length === 0) {
      console.log("더 이상 데이터가 없습니다.");
      break;
    }

    const converted = items
      .filter((item) => item.latitude && item.longitude)
      .map((item) => ({
        type: "가로등",
        name: item.lmpLcNm || "보안등",
        address: item.rdnmadr || item.lnmadr || "",
        lat: Number(item.latitude),
        lng: Number(item.longitude),
      }))
      .filter((item) => !Number.isNaN(item.lat) && !Number.isNaN(item.lng));

    allData.push(...converted);

    console.log(
      `${page}/${maxPage}페이지 수집 완료 / 누적 ${allData.length}개`,
    );

    // 20페이지 도달 시 종료
    if (page >= maxPage) {
      console.log(`${maxPage}페이지 수집 완료 - 종료`);
      break;
    }

    page++;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }

  fs.writeFileSync(LIGHTS_FILE, JSON.stringify(allData, null, 2), "utf-8");

  console.log("보안등 데이터 저장 완료:", allData.length);

  return allData.length;
}

app.get("/collect-safety-lights", async (req, res) => {
  try {
    const count = await collectSafetyLights();

    res.json({
      message: "보안등 데이터 수집 완료",
      count,
    });
  } catch (error) {
    res.status(500).json({
      message: "보안등 데이터 수집 실패",
      error: error.message,
    });
  }
});

function loadCctvData() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, "CCTV정보.csv");

    try {
      const raw = fs.readFileSync(filePath);
      const text = iconv.decode(raw, "cp949");
      const lines = text.split(/\r?\n/);

      if (lines.length < 2) {
        resolve([]);
        return;
      }

      // 헤더 파싱
      const headers = lines[0].split(",").map((h) => h.trim());
      const latIdx = headers.indexOf("WGS84위도");
      const lngIdx = headers.indexOf("WGS84경도");
      const nameIdx = headers.indexOf("설치목적구분");
      const addrIdx = headers.indexOf("소재지도로명주소");
      const addrIdx2 = headers.indexOf("소재지지번주소");

      if (latIdx === -1 || lngIdx === -1) {
        reject(new Error("필수 필드 누락: WGS84위도 또는 WGS84경도"));
        return;
      }

      const rows = [];

      // 데이터 라인 파싱
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(",").map((v) => v.trim());
        const lat = Number(values[latIdx]);
        const lng = Number(values[lngIdx]);

        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          rows.push({
            type: "CCTV",
            name: (nameIdx !== -1 ? values[nameIdx] : "") || "CCTV",
            address:
              (addrIdx !== -1
                ? values[addrIdx]
                : addrIdx2 !== -1
                  ? values[addrIdx2]
                  : "") || "",
            lat,
            lng,
          });
        }
      }

      console.log("CCTV 데이터 로드 완료:", rows.length);
      resolve(rows);
    } catch (error) {
      console.error("CCTV 파일 읽기 에러:", error);
      reject(error);
    }
  });
}

function loadPoliceData() {
  const filePath = path.join(__dirname, "data", "police.geojson");

  const geojson = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  return geojson.features
    .filter((feature) => feature.properties)
    .map((feature) => {
      const parsedLng = Number(feature.properties?.A0);
      const parsedLat = Number(feature.properties?.A1);
      const coords = feature.geometry?.coordinates || [];

      const lng = Number.isFinite(parsedLng) ? parsedLng : Number(coords[0]);
      const lat = Number.isFinite(parsedLat) ? parsedLat : Number(coords[1]);

      return {
        type: "파출소",
        name:
          feature.properties?.NAME ||
          feature.properties?.name ||
          feature.properties?.관서명 ||
          feature.properties?.경찰관서명 ||
          "경찰관서",
        address:
          feature.properties?.ADDRESS ||
          feature.properties?.address ||
          feature.properties?.주소 ||
          "",
        lat,
        lng,
      };
    })
    .filter((item) => {
      return (
        !Number.isNaN(item.lat) &&
        !Number.isNaN(item.lng) &&
        item.lat >= 33 &&
        item.lat <= 39 &&
        item.lng >= 124 &&
        item.lng <= 132
      );
    });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
