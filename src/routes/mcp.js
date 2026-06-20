// src/routes/mcp.js
import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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
];

function buildHandler(db) {
  return async (req) => {
    const { name, arguments: args } = req.params;
    const text = (c) => ({ content: [{ type: 'text', text: typeof c === 'string' ? c : JSON.stringify(c, null, 2) }] });
    try {
      switch (name) {
        case 'list_stations':
          return text(db.prepare('SELECT * FROM stations').all());
        case 'add_station': {
          db.prepare('INSERT INTO stations (station_name,line,driving_distance_km,note) VALUES (?,?,?,?)').run(args.station_name, args.line ?? null, args.driving_distance_km, args.note ?? null);
          return text('追加しました');
        }
        case 'update_station': {
          const { station_name, ...fields } = args;
          const allowed = ['line', 'driving_distance_km', 'note'];
          const sets = Object.keys(fields).filter(k => allowed.includes(k));
          if (sets.length === 0) return text('更新フィールドがありません');
          db.prepare(`UPDATE stations SET ${sets.map(k => `${k}=?`).join(',')} WHERE station_name=?`).run(...sets.map(k => fields[k]), station_name);
          return text('更新しました');
        }
        case 'delete_station':
          db.prepare('DELETE FROM stations WHERE station_name=?').run(args.station_name);
          return text('削除しました');
        case 'list_parkings': {
          const rows = args?.station_name
            ? db.prepare('SELECT * FROM parkings WHERE station_name=?').all(args.station_name)
            : db.prepare('SELECT * FROM parkings').all();
          return text(rows);
        }
        case 'add_parking': {
          const r = db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary,conditions,last_checked,source_url,note) VALUES (?,?,?,?,?,?,?,?)').run(args.station_name, args.parking_name, args.daily_max_fee, args.is_primary ? 1 : 0, args.conditions ?? null, args.last_checked ?? null, args.source_url ?? null, args.note ?? null);
          return text(`追加しました (id: ${r.lastInsertRowid})`);
        }
        case 'update_parking': {
          const { id, ...fields } = args;
          const allowed = ['parking_name', 'daily_max_fee', 'is_primary', 'conditions', 'last_checked', 'source_url', 'note'];
          const sets = Object.keys(fields).filter(k => allowed.includes(k));
          if (sets.length === 0) return text('更新フィールドがありません');
          const values = sets.map(k => k === 'is_primary' ? (fields[k] ? 1 : 0) : fields[k]);
          db.prepare(`UPDATE parkings SET ${sets.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...values, id);
          return text('更新しました');
        }
        case 'delete_parking':
          db.prepare('DELETE FROM parkings WHERE id=?').run(args.id);
          return text('削除しました');
        case 'get_comparison': {
          const settings = {};
          for (const row of db.prepare('SELECT key,value FROM settings').all()) settings[row.key] = row.value;
          const destination = args?.destination || settings.destination_default;
          if (!destination) return text('Error: destination が指定されていません');
          const fareType = args?.fare_type || settings.fare_type || 'IC';
          const stations = db.prepare('SELECT * FROM stations').all();
          const rows = stations.map(station => {
            const parking = db.prepare('SELECT * FROM parkings WHERE station_name=? AND is_primary=1 ORDER BY daily_max_fee ASC LIMIT 1').get(station.station_name)
              || db.prepare('SELECT * FROM parkings WHERE station_name=? ORDER BY daily_max_fee ASC LIMIT 1').get(station.station_name) || null;
            const fare = db.prepare('SELECT * FROM fare_cache WHERE station_name=? AND destination=? AND fare_type=?').get(station.station_name, destination, fareType);
            const fuelEff = Number(settings.fuel_efficiency_km_per_l) || 0;
            const gasPrice = Number(settings.gas_price_per_l) || 0;
            const gasCost = fuelEff ? Math.round((station.driving_distance_km * 2) / fuelEff * gasPrice) : 0;
            const fareRoundTrip = fare ? fare.fare_yen * 2 : null;
            const parkingFee = parking ? parking.daily_max_fee : null;
            const totalCost = fareRoundTrip != null && parkingFee != null ? fareRoundTrip + parkingFee + gasCost : null;
            return { station_name: station.station_name, line: station.line, total_cost: totalCost, fare_round_trip: fareRoundTrip, parking_fee: parkingFee, gas_cost: gasCost };
          });
          rows.sort((a, b) => a.total_cost == null ? 1 : b.total_cost == null ? -1 : a.total_cost - b.total_cost);
          return text(rows);
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  };
}

export function createMcpRouter(db) {
  const router = Router();

  router.all('/', async (req, res) => {
    const server = new Server({ name: 'travel-cost-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, buildHandler(db));

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
