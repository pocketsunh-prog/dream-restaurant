# 夢幻西餐廳 3D ─ 日本編 / Dream Restaurant 3D

以 **three.js** 重製的《夢幻西餐廳》3D 版本，舞台移到**日本**，收錄 **28 個日本知名商圈／溫泉地／市場**，
日式風格餐廳（土壁、木地板、榻榻米座敷、障子、暖簾、提燈、行燈、招財貓、酒樽…），
PBR 材質 + 即時陰影 + ACES 色調映射 + 日夜循環。

本專案與 2D 版（上層目錄）**完全分離**，可獨立執行。

---

## 快速開始

```bash
cd dream-restaurant-3d

# 方式 A：用本專案附的伺服器（預設 8081）
node tools/serve.mjs
# → 瀏覽器開 http://127.0.0.1:8081/

# 方式 B：用上層 2D 專案的伺服器（8080）
cd .. && node tools/serve.mjs
# → 瀏覽器開 http://127.0.0.1:8080/dream-restaurant-3d/
```

> ⚠️ 一定要用 HTTP 伺服器開啟，不能用 `file://` 直接開檔：本專案用 ES module
> 與 import map（`three` → `vendor/three.module.js`），`file://` 會被 CORS 擋下。

**離線可用**：three.js（r160）已經放在 `vendor/`，執行時不需要任何網路連線。

---

## 操作

| 操作 | 說明 |
|---|---|
| 左鍵拖曳 | 環繞餐廳旋轉視角 |
| 滾輪 | 拉近／拉遠 |
| 右鍵或中鍵拖曳 | 平移視角 |
| 雙指 | 縮放 ＋ 平移（觸控） |
| `1`～`5` | 預設機位：全景／吧台／客席／廚房／座敷 |
| `Space` | 暫停 / 繼續 |
| `L` `M` `H` | 立地 / 菜單 / 操作說明面板 |
| `C` | 循環切換機位 |
| `F` | 強制切到夜晚（看提燈與霓虹） |
| `A` | 音效／BGM 開關 |
| `Esc` | 關閉面板 |
| 右下 `❚❚ 1× 2× 4×` | 遊戲速度（1 秒 = 1 遊戲分鐘） |
| 右下 `🔇 音 OFF` + 兩條音量條 | 開啟音訊（♪＝音樂、🔔＝效果音） |

> **音訊需要一次使用者互動才會啟動**（瀏覽器自動播放政策）：按任一鍵或點一下畫面即可。
> 設定（音量、開關）會存在 localStorage。

---

## 音訊（程序化合成，無任何音檔）

全部的音樂與音效都是**即時用 Web Audio 合成**，專案裡沒有任何 `.mp3` / `.wav`。

- **BGM**：以日本音階隨機漫步產生旋律（箏／koto 撥弦：三角波＋兩個泛音），
  加上尺八風的氣息長音（兩支微失諧正弦＋帶通噪音）與太鼓脈動（低頻下滑音＋低通噪音）。
  - 音階：`yo`（陽音階，明亮）／`in`・`miyako`（陰音階・都節，物悲）／`minyo`（民謠）／`ryo`（呂）
  - **依立地類型選音階**：繁華街→陽音階、高級地段→陰音階、溫泉・古街→都節、市場→民謠
  - **依晝夜與時段改變**：夜晚速度放慢、音更疏、太鼓更輕；午間尖峰速度加快、音更密
- **SFX（14 種）**：`door` 引き戸＋門口鈴、`seat` 入座、`order` 點餐、`serve` 上菜、
  `eat` 餐具、`pay` 收銀＋零錢、`angry` 不滿低鳴、`happy` 滿意三音、`settle` 打烊鈴、
  `starup` 升級、`error`、`clink` 杯盤、`whoosh` 搬遷、`click` 按鈕
- **環境音**：店內人聲（帶通噪音，隨在店人數變化）、廚房聲（隨使用中的桌數）、雨聲（下雨時）
- **混音**：master → DynamicsCompressor → 輸出；music／sfx／ambience 三條匯流排可各自調音量；
  同一音效 40ms 內不重複觸發，避免大量顧客同時進店造成破音。

模擬層只負責產生事件（`door` / `seat` / `order` / `serve` / `pay` / `angry`），
呈現層用 `drainEvents(state)` 取用並決定要播什麼，兩邊完全解耦。

---

## 玩法

- **立地（店址）**：28 個日本地點，各有租金、人潮、客層組成、客單價、天氣機率與**名物**。
  星級不足的地點會鎖住；搬遷要付搬遷費（資金不足會被拒絕）。
- **名物加成**：把當地名物放進菜單，來客最多 +28%、該道菜可多賣 12%。
- **顧客**：7 種客群（会社員／学生／観光客／家族連れ／カップル／ご年配／宴会），
  每組 1～6 人，各自有來店時段曲線與耐心值。流程：進店 → 帶位 → 點餐 → 等餐 → 用餐 → 結帳 → 離店。
  沒位子會在店外排隊，等太久會生氣離開（會計入評價）。
- **打烊結算**：營業額 − 食材費 − 家賃 − 水光熱費 − 人件費 ＝ 當日利益，並依服務成功率調整人氣。
- **日夜循環**：遊戲內時間驅動太陽角度、天空色盤、霧氣與室內提燈；日落後提燈與霓虹點亮。

---

## 專案結構

```
dream-restaurant-3d/
  index.html                 遊戲外殼（import map + HUD）
  styles/app.css             和風 UI（墨／藍／朱／生成り／金）
  vendor/
    three.module.js          three.js r160（本地化，離線可用）
    RoomEnvironment.js       PBR 環境反射用
  src/
    main.js                  啟動、主迴圈、輸入、日夜循環、測試掛鉤
    sim/game.js              核心模擬：時間、客流、顧客狀態機、經濟、結算、名物
    scene/
      lighting.js            天空穹頂、太陽／月亮、環境反射、提燈、天氣
      controls.js            自製環繞攝影機（無 addon 依賴）
      restaurant.js          日式餐廳組裝、假接觸陰影（AO）、客人同步
      props.js               31 種程序化日式道具（純幾何＋CanvasTexture）
      characters.js          程序化人物（7 種客群 × 6 種姿勢，含骨架）
    data/
      locations.js           28 個日本地點資料
      dishes.js              44 道日本料理資料
    ui/hud.js                HUD、面板、結算畫面
    audio/audio.js          程序化音訊引擎（BGM／SFX／環境音，含離線渲染驗證 API）
  tools/
    scene-test.html          場景／資料／模擬驗證頁
    audio-test.html          音訊驗證頁（OfflineAudioContext 實際渲染）
    bgm-bisect.html          BGM 各聲部的二分測試（找出哪個合成器有問題時用）
    serve.mjs                零依賴靜態伺服器（預設 8081）
```

---

## 驗證

開 <http://127.0.0.1:8081/tools/scene-test.html>，會檢查：
- 資料集：28 地點（客層與天氣機率合計 100）、44 料理（價格維持成本 2.8～4.2 倍）
- 道具庫：31 種道具全部可建立、`makeProp` 無失敗
- 人物：可建立、骨架齊全、7 種姿勢可用、單人 mesh 數 ≤ 60
- 場景：mesh 數、無 NaN 座標、房間外殼、桌子與座位數一致、**沒有道具退回佔位幾何**
- 模擬：快轉 12 小時後有來客／有服務／營業額 > 0、現金與統計皆為有限數
- 渲染：draw calls、三角形數、白天與夜晚都能出圖

### 音訊驗證

`tools/audio-test.html` 用 **OfflineAudioContext 實際渲染**來證明「真的會發出聲音」
（不需要使用者手勢，也不需要人耳判斷）：

| 網址 | 檢查內容 |
|---|---|
| `?t=sfx` | 14 種音效全部有訊號、沒有破音；引擎行為、立地→音階對應、模擬事件 |
| `?t=music&scale=yo` | BGM 陽音階 |
| `?t=music&scale=in` | BGM 陰音階 |
| `?t=music&scale=miyako` | BGM 都節 |
| `?t=music&scale=night` | BGM 夜晚版（速度較慢、較疏） |

> 這個環境的 headless Chrome 對「同一頁第二個 OfflineAudioContext」會卡住，而且軟體音訊
> 渲染 BGM 約需 6 倍實時 CPU，所以驗證拆成多次載入；實機（有音效裝置）不受影響。

### 測試用網址參數

| 參數 | 說明 |
|---|---|
| `?loc=tokyo_shibuya` | 指定開局地點（id 見 `src/data/locations.js`） |
| `?hour=21` | 直接設定遊戲內時刻（測光影） |
| `?stars=5` | 直接設定星級 |
| `?speed=4` | 開局速度 |
| `?panel=locations` | 開局直接打開面板（locations／menu／help） |
| `?shot=2` | 指定預設機位（0～4） |
| `?ff=120` | 載入後快轉 120 遊戲分鐘 |
| `?static=N` | 只渲染 N 幀後停止（無頭瀏覽器截圖用） |
| `?debug=1` | 在畫面左下顯示相機／draw call／mesh 數等診斷資訊 |

---

## 美術與效能

- **材質**：全部 `MeshStandardMaterial` / `MeshPhysicalMaterial`（PBR），
  貼圖一律用程式產生的 `CanvasTexture`（木紋、榻榻米編織、土壁、和紙、金箔、陶瓷釉、竹節…），
  **不使用任何外部圖檔**。
- **光線**：DirectionalLight（太陽／月亮，2048 陰影圖 + PCFSoft）＋ HemisphereLight 補光
  ＋ PMREM 環境反射 ＋ 5 盞室內點光（提燈／作業燈）。
- **接地感**：每個傢俱／人物腳下都有程序化接觸陰影貼片（AO blob），任何時刻都成立。
- **參考數字**：約 1,400 個 mesh、13 萬～16 萬三角形、1,200～1,400 draw calls。

---

## 授權與致謝

- 遊戲設計與數值參考自 1998 年華藝國際《夢幻西餐廳》，本作為**致敬性質的技術重製**。
- three.js 版權見 <https://threejs.org/>（MIT License），已本地化於 `vendor/`。
