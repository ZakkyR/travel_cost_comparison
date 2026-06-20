// mcp-server/index.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const API_KEY = process.env.MCP_API_KEY || '';

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const TOOLS = [
  { name:'list_stations', description:'登録されている駅の一覧を返す', inputSchema:{type:'object',properties:{}} },
  { name:'add_station', description:'駅を追加する', inputSchema:{type:'object',required:['station_name','driving_distance_km'],properties:{station_name:{type:'string'},line:{type:'string'},driving_distance_km:{type:'number'},note:{type:'string'}}} },
  { name:'update_station', description:'駅情報を更新する', inputSchema:{type:'object',required:['station_name'],properties:{station_name:{type:'string'},line:{type:'string'},driving_distance_km:{type:'number'},note:{type:'string'}}} },
  { name:'delete_station', description:'駅を削除する', inputSchema:{type:'object',required:['station_name'],properties:{station_name:{type:'string'}}} },
  { name:'list_parkings', description:'駐車場一覧を返す。station_name で絞り込み可', inputSchema:{type:'object',properties:{station_name:{type:'string'}}} },
  { name:'add_parking', description:'駐車場を追加する', inputSchema:{type:'object',required:['station_name','parking_name','daily_max_fee'],properties:{station_name:{type:'string'},parking_name:{type:'string'},daily_max_fee:{type:'number'},is_primary:{type:'boolean'},conditions:{type:'string'},last_checked:{type:'string'},source_url:{type:'string'},note:{type:'string'}}} },
  { name:'update_parking', description:'駐車場情報を更新する', inputSchema:{type:'object',required:['id'],properties:{id:{type:'number'},parking_name:{type:'string'},daily_max_fee:{type:'number'},is_primary:{type:'boolean'},conditions:{type:'string'},last_checked:{type:'string'},source_url:{type:'string'},note:{type:'string'}}} },
  { name:'delete_parking', description:'駐車場を削除する', inputSchema:{type:'object',required:['id'],properties:{id:{type:'number'}}} },
  { name:'get_comparison', description:'コスト比較表を取得する', inputSchema:{type:'object',properties:{destination:{type:'string'},fare_type:{type:'string',enum:['IC','ticket']}}} },
  { name:'import_csv', description:'CSV文字列をインポートする', inputSchema:{type:'object',required:['type','csv_content'],properties:{type:{type:'string',enum:['stations','parkings']},csv_content:{type:'string'}}} },
];

const server = new Server({ name:'travel-cost-mcp', version:'1.0.0' }, { capabilities:{ tools:{} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const text = (c) => ({ content:[{ type:'text', text: typeof c==='string'?c:JSON.stringify(c,null,2) }] });
  try {
    switch (name) {
      case 'list_stations': return text(await api('GET', '/api/stations'));
      case 'add_station': return text(await api('POST', '/api/stations', args));
      case 'update_station': { const { station_name, ...f } = args; return text(await api('PUT', `/api/stations/${encodeURIComponent(station_name)}`, f)); }
      case 'delete_station': return text(await api('DELETE', `/api/stations/${encodeURIComponent(args.station_name)}`));
      case 'list_parkings': return text(await api('GET', `/api/parkings${args.station_name?`?station=${encodeURIComponent(args.station_name)}`:''}`));
      case 'add_parking': return text(await api('POST', '/api/parkings', { ...args, is_primary: args.is_primary ? 1 : 0 }));
      case 'update_parking': { const { id, ...f } = args; if (f.is_primary!=null) f.is_primary = f.is_primary?1:0; return text(await api('PUT', `/api/parkings/${id}`, f)); }
      case 'delete_parking': return text(await api('DELETE', `/api/parkings/${args.id}`));
      case 'get_comparison': {
        const p = new URLSearchParams();
        if (args.destination) p.set('destination', args.destination);
        if (args.fare_type) p.set('fare_type', args.fare_type);
        return text(await api('GET', `/api/compare?${p}`));
      }
      case 'import_csv': {
        const blob = new Blob([args.csv_content], { type: 'text/csv' });
        const form = new FormData(); form.append('file', blob, `${args.type}.csv`);
        const res = await fetch(`${BASE_URL}/api/import/${args.type}`, { method:'POST', headers:{'Authorization':`Bearer ${API_KEY}`}, body:form });
        return text(await res.json());
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return { content:[{ type:'text', text:`Error: ${e.message}` }], isError:true };
  }
});

await server.connect(new StdioServerTransport());
