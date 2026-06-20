// src/services/ekispert.js
// ※ APIキー取得後に公式ドキュメントでURL・パラメータ・レスポンス構造を確認して調整すること
import fetch from 'node-fetch';

const BASE_URL = 'https://api.ekispert.jp/v1/json/search/course/light';

export async function fetchFare(from, to, fareType, apiKey) {
  const params = new URLSearchParams({
    key: apiKey,
    from,
    to,
    searchType: '3',
    icCardFlg: fareType === 'IC' ? '1' : '0',
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`Ekispert API error: ${res.status}`);
  const data = await res.json();

  // ※ 以下のパスは実際のAPIレスポンスに合わせて調整すること
  const course = data?.ResultSet?.Course?.[0];
  if (!course) throw new Error('No route found in API response');

  const priceList = Array.isArray(course.Price) ? course.Price : [course.Price];
  const priceEntry = priceList.find(p => fareType === 'IC' ? p?.kind === 'IC' : p?.kind === 'Normal') ?? priceList[0];

  return {
    fare_yen: Number(priceEntry?.Oneway ?? 0),
    travel_minutes: Number(course.Route?.timeOnBoard ?? 0),
    transfers: Number(course.Route?.transferCount ?? 0),
    route_url: course.Route?.linkUrl ?? null,
  };
}
