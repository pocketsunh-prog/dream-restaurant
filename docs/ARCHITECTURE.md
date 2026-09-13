# 《夢幻西餐廳》復刻 — 架構與介面契約 (ARCHITECTURE)

> 本文件是實作依據。**任何模組都必須遵守此處定義的介面**，不得自行更名或改變資料形狀。
> 目標：零外部依賴（無框架、無 CDN、無 build step），原生 HTML + CSS + ES Modules。

## 0. 檔案地圖與責任分工

```
index.html                     遊戲外殼（我）
styles/reset.css               基本 reset（我）
styles/ui.css                  90 年代米黃色視窗設計系統（我）
styles/game.css                版面（我）
tools/serve.mjs                零依賴靜態伺服器（我）
src/main.js                    進入點、主迴圈、面板註冊（我）
src/core/rng.js                可存取的決定性亂數（我）
src/core/state.js              狀態建立／序列化（我）
src/core/store.js              store / dispatch / subscribe（我）
src/core/actions.js            reducer（我）
src/core/save.js               localStorage 存讀檔（我）
src/core/audio.js              WebAudio 程序化音效 + BGM（我）
src/sim/pathfind.js            A* 與動線（我）
src/sim/build.js               傢俱網格、合法性、裝潢分數（我）
src/sim/simulation.js          主模擬（我）
src/sim/customer.js            顧客 AI（我）
src/sim/staffai.js             員工 AI 與職務（我）
src/sim/economy.js             財務結算（我）
src/sim/rating.js              評價、星級（我）
src/sim/magazine.js            雜誌排名（我）
src/sim/events.js              突發事件執行（我）
src/sim/attract.js             拉客／路人（我）

src/data/dishes.js             ★ 資料：料理          （DATA 代理）
src/data/staff.js              ★ 資料：員工          （DATA 代理）
src/data/locations.js          ★ 資料：地點          （DATA 代理）
src/data/furniture.js          ★ 資料：傢俱/設備      （DATA 代理）
src/data/events.js             ★ 資料：事件表        （DATA 代理）
src/data/index.js              ★ 彙總出口            （DATA 代理）

src/render/palette.js          ★ 調色盤              （RENDER 代理）
src/render/sprites.js          ★ 程序化像素圖        （RENDER 代理）
src/render/floor.js            ★ 等角平面渲染器      （RENDER 代理）

src/ui/widgets.js              共用 UI 元件（我）
src/ui/windows.js              視窗管理員（我）
src/ui/hud.js                  頂列與工具列（我）
src/ui/panels/menu.js          ★ 菜單／進貨面板      （UI-A 代理）
src/ui/panels/staff.js         ★ 員工／排班面板      （UI-A 代理）
src/ui/panels/build.js         ★ 裝潢／設備面板      （UI-A 代理）
src/ui/panels/report.js        ★ 報表／雜誌面板      （UI-B 代理）
src/ui/panels/settings.js      ★ 空調／音樂／營業時間（UI-B 代理）
src/ui/panels/system.js        ★ 存檔／搬遷／教學     （UI-B 代理）
src/ui/settle.js               ★ 週結算／升星／大獎動畫（UI-B 代理）

tests/smoke.mjs                無 DOM 7 天模擬煙霧測試（我）
```

---

## 1. 座標與幾何

- 等角（isometric）菱形網格：`TILE_W = 42`、`TILE_H = 21`，邏輯畫布 `960 × 600`。
  （像素尺寸的單一來源是 `src/render/iso.js`；`src/core/balance.js` 鏡射一份，`main.js` 啟動時用常數覆寫 canvas 尺寸）
- 網格尺寸 `20 × 13`（`GRID_W=20, GRID_H=13`）。
- 螢幕座標換算（`src/render/iso.js` 概念，統一由 `floor.js` 出口提供）：

```js
tileToScreen(x, y) => {
  px = ORIGIN_X + (x - y) * (TILE_W / 2);
  py = ORIGIN_Y + (x + y) * (TILE_H / 2);
}
// ORIGIN_X = LOGICAL_W / 2 - (GRID_W - GRID_H) * TILE_W / 4   // 置中
// ORIGIN_Y = 96
screenToTile(px, py) => 上述反解，四捨五入。
```

- 每個 tile 可為：`'floor' | 'wall' | 'door' | 'kitchen' | 'pass' | 'restroom' | 'void'`（由 `layout.tiles` 決定，見 §3.5）。

---

## 2. 資料契約（DATA 代理必須逐欄遵守）

### 2.1 `src/data/dishes.js`

```js
export const DISH_CATEGORIES = ['staple','side','soup','drink','alcohol','dessert','secret'];
export const TAG_LIST = ['spicy','mild','sweet','cold','hot','fried','seafood','noodle','rice','meat','veg',
                         'local','tourist','cheap','premium','quick','alcohol','caffeine','dessert','soup'];

export const DISHES = [{
  id: 'hamburg_steak',        // snake_case 唯一
  name: '漢堡牛肉餅',
  category: 'staple',
  baseCost: 25,               // 基準材料成本（元），最低 5
  expectedPrice: 180,         // 顧客心中的合理價（元）
  unlockStars: 1,             // 1..5；secret 類為 5
  secret: false,
  tags: ['meat','fried','hot'],
  cookTimeDefault: 25,        // 分鐘
  portionDefault: 55,         // 0..100
  tasteDefault: 60,           // 0..100
  gradeDefault: 50,           // 0..100
  popularity: {               // 各地點受歡迎度 0.2 ~ 2.0，鍵為 LOCATIONS[].id
    zhongli_xinming: 1.9, keelung_miaokou: 1.1, taipei_nanyang: 1.2,
    taichung_zhonghua: 1.3, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.3
  },
  desc: '鐵板滋滋作響，夜市裡的無敵招牌。'
}];
// 至少 66 道：含 category 'secret' 2 道（歌名梗，secret:true, unlockStars:5）
export function getDish(id) {}            // 找不到回 undefined
export function dishesForStars(stars) {}  // 回傳 unlockStars <= stars 的陣列
```

### 2.2 `src/data/staff.js`

```js
export const STAFF_POOL = [{
  id: 'w_ah_long', name: '阿龍', role: 'waiter',   // 'waiter' | 'chef'
  age: 22, gender: 'm',
  speed: 62,        // 1..100 移動速度
  skill: 55,        // 1..100 廚藝(chef) / 服務(waiter)
  stamina: 70,      // 1..100 抗疲勞
  wage: 3,          // 期望時薪（元）基準值；原作常見 2~10
  initWage: 3,      // 初始時薪
  specialty: 'staple',  // 擅長菜系 category，僅 chef 有意義；waiter 填 'all'
  personality: 'diligent', // diligent|cheerful|grumpy|lazy|pro|rookie
  desc: '夜市長大的少年，端盤子像在跳舞。',
  portrait: { hair: '#2b1b12', skin: '#f0c9a0', shirt: '#3a6ea5', hat: 0 }
}];
// 至少 26 位：14 服務生 + 10 廚師 + 2 特殊(高能力高薪，wage >= 9)
export function staffById(id) {}
export function makeCandidateList(day, count, rng) {} // 回傳 count 位 {candidateId, staffId, askWage}
```

### 2.3 `src/data/locations.js`

```js
export const LOCATIONS = [{
  id: 'zhongli_xinming',
  name: '中壢新明夜市',
  city: '桃園',
  starsRequired: 1,
  rentPerDay: 1800,
  baseTraffic: 1.0,          // 人/遊戲分鐘 基準（0.6 ~ 2.4）
  moveCost: 0,
  gridW: 20, gridH: 13,      // 可用網格（實際格局見 §3.5）
  customerMix: { student: 0.4, office: 0.15, family: 0.3, tourist: 0.1, critic: 0.03, vip: 0.02 },
  tastePrefs: ['cheap','fried','local','meat','quick'],
  weatherWeights: { sunny: 0.4, cloudy: 0.25, rain: 0.2, storm: 0.05, cold: 0.05, heat: 0.05 },
  decorStyle: 'nightmarket',   // 對應 furniture.style
  skyline: 'nightmarket',      // 給 RENDER 畫窗外街景
  palette: { sky:'#1b2340', wall:'#c9a26b', floor:'#8c6a44', accent:'#e8552e' },
  desc: '一切從這個小小的夜市開始。'
}];
// 6 個地點，starsRequired 依序 1,2,3,4,4,5（見 GAME_PROMPT.md §3.9）
export function getLocation(id) {}
export function locationsForStars(stars) {}
```

### 2.4 `src/data/furniture.js`

```js
export const FURNITURE = [{
  id: 'table_2a', name: '二人方桌', category: 'table',
  // category: table|chair|counter|decor|equipment|restroom|kitchen
  w: 1, h: 1,                 // 佔用格數
  price: 1200,
  seats: 2,                   // 可坐人數，非桌椅為 0
  seatFacing: ['N','S'],      // 座位朝向（供顧客就坐顯示）
  decorScore: 6,              // 裝潢分數
  style: 'nightmarket',       // nightmarket|harbor|office|nightmarket2|mall|fashion|plain
  blocks: true,               // 是否阻擋通行
  needsAdjacentFloor: true,   // 擺放合法性檢查
  durability: 100,            // 損壞系統
  desc: '夜市攤風格的小方桌。'
}];
// 至少 34 件：桌子(6)、椅子(3)、櫃台(2)、裝潢(10)、設備(8: 冷氣/音響/監視器/紅外線/滅火器/保全主機/燈具/冰箱)、廁所(2)、廚房(3)
export function furnitureById(id) {}
export function furnitureByCategory(cat) {}
export function equipmentList() {}   // category === 'equipment'
```

### 2.5 `src/data/events.js`

```js
export const EVENTS = [{
  id: 'tv_interview', name: '電視台採訪',
  kind: 'positive',            // positive|negative|neutral
  weight: 6,                   // 相對權重
  minStars: 1, maxStars: 5,
  locations: null,             // null = 全部；否則為 id 陣列
  onlyWhileOpen: true,
  mitigateBy: null,            // 例：['cctv','infrared']
  message: '電視台聞風而來，攝影機對準了你的招牌菜！',
  effects: { fame: 12, reputation: { community: 6, outside: 14 }, cash: 0, moodAll: 10, supplierPriceMul: 1, trafficMul: 1.8, trafficMulMinutes: 120, damage: null, stockLoss: 0 },
  log: '電視採訪：知名度大幅提升。'
}];
// 至少 30 件（正面 12、負面 14、中性 4），必須包含：
// 電視採訪、美食評論家突擊、名人來訪、社區活動補助、隔壁倒閉帶來人流、
// 爐具故障、冷氣故障、冰箱故障、停電、食材漲價、老鼠出沒、宵小竊盜、
// 員工請假、員工離職、食物中毒、奧客鬧場、廁所堵塞、漏水
export function eventsFor(stars, locationId) {}
```

### 2.6 `src/data/index.js`
```js
export * from './dishes.js'; export * from './staff.js'; export * from './locations.js';
export * from './furniture.js'; export * from './events.js';
```

---

## 3. 狀態契約

### 3.1 根狀態（`createNewGame`）

```js
{
  version: 1,
  seed: 20240101,
  rng: 123456789,            // rng.getState() 的存檔值
  day: 1,                    // 1 起算；day 1 = 週一
  minute: 600,               // 當日遊戲分鐘 0..1439
  speed: 1,                  // 0|1|2|4
  phase: 'build',            // build|open|closing|closed|settle|gameover
  locationId: 'zhongli_xinming',
  stars: 1,
  fame: 6,                   // 0..100
  cash: 300000,
  reputation: { community: 350, outside: 350 },  // 0..500
  settings: {
    openMinute: 660, closeMinute: 1380,   // 11:00 - 23:00
    acTemp: 24,                           // 16..30
    music: 'lazy',                        // lazy|tropical|classic1|classic2|pop|off
    openDays: [true,true,true,true,true,true,true]  // 週一..週日
  },
  menu: [ /* MenuEntry */ ],
  stock: { [dishId]: servings },        // 庫存份數（僅上架料理有意義）
  store: { [dishId]: servings },        // 倉庫（未上架也可存）
  suppliers: [ {dishId, servings, arriveMinute} ],  // 在途
  staff: [ /* HiredStaff */ ],
  candidates: [ /* {candidateId, staffId, askWage} */ ],
  layout: {
    gridW: 20, gridH: 13,
    tiles: [ /* gridW*gridH 的字串，索引 y*gridW+x */ ],
    items: [ {uid, typeId, x, y, w, h, rot, durability, broken} ],
    entrances: [{x,y}], passTiles: [{x,y}], restroom: {x,y}
  },
  sim: {
    customers: [], walkers: [],
    tables: [ {uid, itemUid, x, y, seats:[{x,y,facing}], occupants:[customerId...], state:'clean'|'dirty'|'reserved', dirtySince:null, waiterUid:null} ],
    complaintLog: [], tipLog: [],
    lureBoost: 0, lureDecayMinute: 0,
    activeEvents: [ {eventId, untilMinute, effects} ],
    trafficMul: 1, supplierPriceMul: 1,
    dirt: { floor: 0, restroom: 0 },      // 0..100
    equipBroken: { ac:false, stove:false, fridge:false },
    spawnAccumulator: 0
  },
  stats: {
    today: { revenue:0, spend:0, guests:0, angry:0, served:0, waitSum:0, waitCount:0, tips:0, wages:0, rent:0, utilities:0, inventory:0 },
    history: [ /* 每日 DailyStat */ ],       // 見 §3.4
    weekly: [ /* WeeklyStat */ ],
    magazine: { rank: {}, lastSettleDay: 0 },
    ratingsScore: { taste:0, service:0, decor:0, price:0, popularity:0 }
  },
  flags: { tutorialDone:false, annualAward:false, secretUnlocked:false, warnedWeek:0 },
  log: [ {day, minute, text, kind} ]        // 最多 200 筆
}
```

### 3.2 `MenuEntry`
```js
{ dishId, price, grade, taste, portion, cookTime, active: true, sold: 0 }
```

### 3.3 `HiredStaff`
```js
{ uid, staffId, name, role, wage, hireDay, shift:{start:600, end:1380},
  duties: { escort:true, serve:true, order:true, bus:true, cleanRestroom:false, cleanFloor:false, cashier:false },
  fatigue: 0, mood: 70, specialty, speedMod: 1, working:false, x:0, y:0,
  target: null, path: [], state: 'idle' }
```

### 3.4 `DailyStat` / `WeeklyStat`
```js
DailyStat = { day, locationId, weather, revenue, spend, profit, guests, served, angry,
              avgWaitSec, avgMood, wages, rent, utilities, inventory, tips, complaints:{},
              repCommunity, repOutside, fame, stars, magazineRank }
WeeklyStat = { week, startDay, endDay, revenue, profit, guests, served, angry,
               scores:{taste,service,decor,price,popularity}, ranks:{...}, totalRank,
               repCommunity, repOutside, starsAwarded }
```

### 3.5 餐廳格局 `layout.tiles`
- 每個地點由 `src/sim/build.js#defaultLayout(location)` 產生預設格局：
  - 外圍一圈 `'wall'`；
  - 南牆 1 格 `'door'`（顧客入口，位置依地點而異）；
  - 西／北側為 `'kitchen'` 區，與用餐區之間有 `'pass'`（出餐口）1–2 格；
  - 東南角 `'restroom'` 2 格；
  - 其餘 `'floor'`。

---

## 4. Store 契約（UI 只能透過 action 改狀態）

```js
// src/core/store.js
export const store = {
  getState(),                 // 唯讀狀態（UI 不得直接改）
  dispatch(action),           // 回傳 {ok:boolean, error?:string}
  subscribe(fn),              // fn(state) 於每次變更後呼叫；回傳 unsubscribe
  select(fn)                  // 便捷讀取
};
```

### Action 一覽（UI 只可使用這些）

| type | payload | 說明 |
|---|---|---|
| `SET_SPEED` | `{value}` | 0/1/2/4 |
| `SET_HOURS` | `{openMinute, closeMinute}` | |
| `TOGGLE_DAY` | `{index}` | 營業日設定 |
| `SET_AC` | `{temp}` | |
| `SET_MUSIC` | `{id}` | |
| `MENU_ADD` | `{dishId}` | 上架（檢查星級／上限） |
| `MENU_REMOVE` | `{dishId}` | |
| `MENU_UPDATE` | `{dishId, patch}` | price/grade/taste/portion/cookTime |
| `MENU_TOGGLE` | `{dishId}` | 暫時停售 |
| `BUY_STOCK` | `{dishId, servings}` | 立即進貨（扣款，30 分後到） |
| `HIRE` | `{candidateId}` | |
| `FIRE` | `{uid}` | 需付資遣費 |
| `SET_WAGE` | `{uid, wage}` | |
| `SET_SHIFT` | `{uid, start, end}` | |
| `SET_DUTY` | `{uid, duty, on}` | |
| `PLACE_FURNITURE` | `{typeId, x, y, rot}` | |
| `MOVE_FURNITURE` | `{uid, x, y}` | 拖曳或用工具列的「移動」 |
| `ROTATE_FURNITURE` | `{uid, rot?, swapFootprint?}` | 不給 `rot` 就轉一格（0=S,1=E,2=N,3=W）；矩形傢俱會一併換算佔地 |
| `REPLACE_FURNITURE` | `{uid, typeId}` | 就地更換同類傢俱：舊品退 50%、只收差額、沿用 uid（桌上客人與髒污狀態不會斷） |
| `REMOVE_FURNITURE` | `{uid}` | 退 50% |
| `CLEAR_LAYOUT` | `{}` | 清空（退 50%） |
| `SET_TILE` | `{x, y, tile}` | 僅限 wall/kitchen/pass/restroom 編輯（進階） |
| `REPAIR` | `{uid}` / `{target:'ac'\|'stove'\|'fridge'}` | |
| `CLEAN` | `{target:'floor'\|'restroom'}` | 玩家手動花錢清潔 |
| `START_DAY` | `{}` | build → open |
| `END_DAY` | `{}` | 強制打烊 |
| `LURE` | `{}` | 點路人拉客，+boost |
| `MOVE_LOCATION` | `{locationId}` | 需星級足夠且 phase 為 build/closed |
| `SAVE_GAME` | `{slot}` | |
| `LOAD_GAME` | `{slot}` | |
| `NEW_GAME` | `{seed?}` | |
| `ACK_SETTLE` | `{}` | 關閉週結算視窗 |

`dispatch` 回傳 `{ok:false, error:'訊息'}` 時，UI 必須以 `ui.toast(error)` 顯示。

---

## 5. UI 契約

### 5.1 `src/ui/widgets.js`（我提供，UI 代理只可使用）

```js
export function h(tag, props, ...children)      // 建立 DOM（props 支援 class/style/onclick/dataset）
export function el(html)                        // 由 HTML 字串建立（僅供靜態模板，禁止插入玩家輸入）
export function button(label, onClick, opts)    // opts: {kind:'primary'|'danger'|'ghost', disabled, title}
export function numberField({label, value, min, max, step, onChange, suffix})  // 回傳 {el, set(value)}
export function slider({label, value, min, max, step, onChange, suffix})       // 回傳 {el, set(value)}
export function select({label, value, options, onChange})                      // options: [{value,label}]
export function checkbox({label, checked, onChange})
export function tabs(items)                     // items:[{id,label,render() -> HTMLElement}] 回傳 {el, setActive(id)}
export function table({columns, rows, empty})   // columns:[{key,label,width,align,format(v,row)}]
export function bar({value, max, color, label, showValue})   // 進度條
export function stars(n, max=5)                 // 星級顯示
export function money(n)                        // 'NT$ 12,345'
export function toast(msg, kind)                // kind: info|good|bad|warn
export function confirmDialog({title, message, okLabel, cancelLabel})  // Promise<boolean>
export function promptNumber({title, message, value, min, max})        // Promise<number|null>
export function section({title, children, collapsible})
export function statRow(label, value, opts)
```

### 5.2 `src/ui/windows.js`（我提供）

```js
export class WindowManager {
  register(id, factory)   // factory({store, ui, win}) -> {title, icon, open(), close(), refresh(state), el}
  openWindow(id)
  closeWindow(id)
  toggle(id)
  refreshAll(state)
}
export const windows = new WindowManager();
```

### 5.3 面板模組契約（UI 代理必須遵守）

```js
// 每個 src/ui/panels/*.js 匯出：
export function createXxxPanel({ store, ui, win }) {
  return {
    id: 'menu',
    title: '菜單編輯',
    icon: '🍜',
    width: 520, height: 420,       // 建議尺寸（px），供視窗定位
    el,                            // 面板根 DOM（掛載時才建立亦可，但 refresh 前必須存在）
    open() {},                     // 顯示時呼叫；可在此重建內容
    close() {},                    // 隱藏時呼叫
    refresh(state) {}              // store 每次變更後呼叫；必須是幂等且便宜的
  };
}
```

- **禁止**：面板內直接修改 `state`；一律 `store.dispatch({...})`。
- 面板必須處理「資料不足」情境（無員工、無庫存、沒上架料理）並顯示友善空狀態。
- 所有面板文字使用繁體中文、台灣用語。
- 禁止使用 inline `style` 以外的外部資源；不得引入任何 JS/CSS 檔案。

### 5.4 `ui` 物件（由 main.js 注入）
```js
ui = { toast, confirm: confirmDialog, promptNumber, sfx(name), openWindow, closeWindow,
       toastKind: {info,good,bad,warn} }
// sfx name 可選：'click','open','close','cash','bell','error','star','settle','alarm','pour'
```

---

## 6. RENDER 契約

```js
// src/render/palette.js
export const PALETTE = { /* 命名色票，16-bit 風格 */ };
export function color(name) {}

// src/render/sprites.js
export const SPRITE_NAMES = [...];
export function drawSprite(ctx, name, x, y, opts)  // opts: {frame, dir:'N'|'S'|'E'|'W', scale=1, flip, tint}
export function drawPerson(ctx, appearance, x, y, opts)  // appearance: {hair, skin, shirt, hat}
export function drawFurniture(ctx, typeId, x, y, opts)   // x,y 為螢幕座標（傢俱底部中心）；opts:{w,h,ghost,broken,rot,frame}
export function drawTile(ctx, tile, sx, sy)              // 畫一個等角菱形地板/牆
export function drawSkyline(ctx, kind, x, y, w, h, timeOfDay)  // 窗外街景
export function drawWeather(ctx, weather, w, h, tick)    // 雨/雪/熱浪濾鏡

// src/render/floor.js
export class FloorRenderer {
  constructor(canvas, { tileW=28, tileH=14, originX, originY })
  setLayout(layout)                     // 更新 tiles/items 快取
  tileToScreen(x, y)                    // -> {px, py}
  screenToTile(px, py)                  // -> {x, y}
  render(state, view)                   // 主繪製
  // view: { frame, hover:{x,y}, ghost:{typeId,x,y,valid}, selectionUid, showGrid,
  //         focusItemUid, debugPaths:boolean, hoverCustomerUid }
  hitTestItem(px, py)                   // -> item | null
  hitTestCustomer(px, py)               // -> customer | null
}
```

`render` 的繪製順序：地板 → 牆／街景 → 依 `x+y` 排序的 items 與人物 → 天氣 → 網格 → 幽靈傢俱 → 提示氣泡。
所有繪圖皆為程式化像素（`ctx.fillRect` 為主，必要時用 `ImageData` 生成快取 canvas），**不得載入外部圖片**。

---

## 7. 模擬契約（我）

```js
// src/sim/simulation.js
export function stepSimulation(state, dtSeconds, ctx)   // 就地更新 state（store 內部使用）
export function beginDay(state)
export function endDay(state)        // 回傳 DailyStat（已 push 進 history）
export function startBusiness(state)
```
- 純邏輯、不得碰 DOM、不得使用 `Date.now()`（時間一律由參數傳入或從 state 推導）。
- 亂數一律取自 `src/core/rng.js` 注入的 `rng`（存於 state.rng）。
