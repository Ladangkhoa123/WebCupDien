const cron = require('node-cron');
const app = require('./app');
const { createUpcomingAlerts } = require('./refresh');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
  console.log(`BTS Power Monitor is listening on http://${host}:${port}`);
  console.log(process.env.EVNSPC_PUBLIC_API_URL
    ? 'Licensed EVNSPC API refresh is scheduled for 06:00 Asia/Ho_Chi_Minh.'
    : 'Chưa kết nối nguồn dữ liệu tự động. Scheduled EVNSPC sync is disabled.');
});

if (process.env.EVNSPC_PUBLIC_API_URL) {
  cron.schedule('0 6 * * *', async () => {
    const { refreshOutages } = require('./refresh');
    const result = await refreshOutages();
    if (!result.ok) console.error(`Scheduled EVNSPC refresh failed: ${result.message}`);
  }, { timezone: 'Asia/Ho_Chi_Minh' });
}

cron.schedule('0 * * * *', createUpcomingAlerts, { timezone: 'Asia/Ho_Chi_Minh' });
