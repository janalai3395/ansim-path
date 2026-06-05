const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());

app.get("/route", async (req, res) => {
  const { origin, destination } = req.query;

  try {
    const response = await fetch(
      `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin}&destination=${destination}&priority=RECOMMEND`,
      {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
        },
      },
    );

    const data = await response.json();

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "길찾기 실패",
    });
  }
});

app.get("/config", (req, res) => {
  res.json({
    kakaoJsKey: process.env.KAKAO_JS_KEY,
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

app.get("/safety-lights", async (req, res) => {
  const page = req.query.page || 1;
  const perPage = req.query.perPage || 100;

  const url =
    `https://api.data.go.kr/openapi/tn_pubr_public_scrty_lmp_api` +
    `?serviceKey=${encodeURIComponent(process.env.PUBLIC_DATA_KEY)}` +
    `&pageNo=${page}` +
    `&numOfRows=${perPage}` +
    `&type=json`;

  try {
    const response = await fetch(url);
    const text = await response.text();

    console.log("공공데이터 원본 응답:", text.slice(0, 300));

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      return res.status(500).json({
        message: "공공데이터가 JSON이 아닌 형식으로 응답했습니다.",
        raw: text.slice(0, 300),
      });
    }

    const items = data.response?.body?.items || [];

    const result = items
      .filter((item) => item.latitude && item.longitude)
      .map((item) => ({
        type: "가로등",
        name: item.securityLightManageNo || "보안등",
        address: item.rdnmadr || item.lnmadr || "",
        lat: Number(item.latitude),
        lng: Number(item.longitude),
      }));

    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: "보안등 데이터 조회 실패",
      error: error.message,
    });
  }
});
