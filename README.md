# 分揀貨量管理儀表板

純靜態 HTML + Chart.js 單頁儀表板，資料以 `localStorage` 儲存在瀏覽器。

## 檔案結構

```
dashboard/
├─ index.html       主畫面
├─ styles.css       樣式
├─ app.js           儀表板邏輯（KPI、圖表、預測、延遲判斷、差異警示）
├─ seed-data.js     從 2026分揀揀次.xlsx 萃取的近30天歷史資料
├─ extract_seed.py  重新產生 seed-data.js 的腳本
└─ README.md
```

## 本機開啟

直接用瀏覽器打開 `index.html` 即可。若遇到 CSP 或 `file://` 載入問題，可以起一個簡易本機伺服器：

```bash
cd dashboard
python -m http.server 8080
# 打開 http://localhost:8080
```

## 更新 seed 資料

當 `2026分揀揀次.xlsx` 的總表新增了日期、需要把新歷史匯入儀表板時：

```bash
cd dashboard
python extract_seed.py
```

會覆寫 `seed-data.js`，取「今天前 30 天」有資料的日期。若要改抓取的參考日，改 `extract_seed.py` 最上方的 `TODAY`。

## 使用流程

1. **早上**：在「今日預估」區輸入當天預估揀次 → 系統以近30日平均 pcs/箱比推算預估箱數，並依同星期幾歷史平均換算預估總結束時間與準時/延遲狀態。
2. **隔日**：在「實際資料回填」區選擇昨日日期，填入實際揀次、實際總箱數、總結束時間，以及（選填）11 個節點 A/B 班結束時間。
3. **差異警示**：若實際揀次與預估揀次差距 ≥ 10,000，會自動出現黃色警示框，需填寫差異原因才完整。
4. **延遲分析**：KPI「完成狀態」或歷史表「延遲」標籤可點擊，彈窗顯示當日各節點 A/B 班實際 vs 標準的差異。

## 判斷規則

- **標準總結束時間**：取所有節點標準時間中的最晚值（目前＝大溪3 23:30）。
- **準時**：實際總結束時間 ≤ 23:30
- **延遲**：實際總結束時間 > 23:30（超過多少分會顯示）
- 若實際為 0 點之後，會視為隔日作自動校正（+24 小時）

## 資料儲存

- 使用者輸入（預估揀次、實際回填、節點時間、備註）存於 `localStorage`，key = `sort_dashboard_v1`
- seed 資料是唯讀；使用者輸入同日期會覆蓋 seed 的欄位
- 如需清空：瀏覽器 DevTools → Application → Local Storage 刪除該 key

## 線上部署

選一種即可：

### A. Vercel / Netlify（最快）
1. 把 `dashboard/` 資料夾丟進一個 Git repo
2. 到 [vercel.com](https://vercel.com) 或 [netlify.com](https://netlify.com) Import repo
3. Framework preset 選 "Other"；Publish directory 選 `dashboard`
4. Deploy，拿到網址

### B. GitHub Pages
1. 建立 repo，push 全部檔案
2. Settings → Pages → Source 選 `main` branch 的 `/dashboard`（或把檔案放在 root）
3. 網址 `https://<user>.github.io/<repo>/`

### C. Cloudflare Pages
1. Connect repo，Build command 留空，Output directory 填 `dashboard`
2. Deploy

> ⚠️ 注意：`localStorage` 是「每瀏覽器獨立」。多人協作/跨裝置同步需要改成後端儲存（例如 Supabase、Firebase、Google Sheets API）。第一版先單機使用沒問題，之後要改我可以再延伸。

## 後續可擴充

- 多人共用 → 接 Supabase / Firestore
- 認證 → Magic link or Google OAuth
- 匯出 → 一鍵下載當月 CSV / 回寫 xlsx
- 通知 → 延遲時 LINE Notify / Slack webhook
